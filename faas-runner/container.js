// The module for launching a container and shutting down a container.
const PROTO_PATH=__dirname+"/proto/faas-runner.proto";
const grpc=require('grpc');
const protoLoader=require("@grpc/proto-loader");
const packageDef=protoLoader.loadSync(PROTO_PATH, {"keepCase": true, "longs": BigInt, "enums": String, "defaults": true, "oneofs": true});
const LaserContainer=grpc.loadPackageDefinition(packageDef).Laser.LaserContainer;

const invoke=require('./invoke');
const fs=require('fs');
const bluebird=require('bluebird');
const uuid=require('uuid/v4');
const process=require('process');
const net=require('net');
const EventEmitter=require('events').EventEmitter;
bluebird.promisifyAll(fs);
const self={
	networkConfig:fs.readFileSync("/opt/cni/netconfs/10-laser.conf", "utf-8"),
	containerConfig: fs.readFileSync("/runtime/config.json.template", "utf-8"),
	runcPath:"runc",
	bridgePath:"/opt/cni/bin/bridge",
	mountPath:"mount",
	umountPath:"umount",
	mkdirPath:"mkdir",
	ipcRoot:"/ipc",
	getContainerName: function(id){
		return "laser-app-"+id;
	},
	getNetworkName: function(id){
		return "laser-nw-"+id;
	},
	getIPCPath: function(id){
		return self.ipcRoot+"/"+id;
	},
	getAppPath: function(id){
		return self.getIPCPath(id)+"/app";
	},
	getPIDFile: function(id){
		return self.getIPCPath(id)+"/pid"
	},
	getNetworkNS: function(pid){
		return "/proc/"+pid+"/ns/net";
	},
	getTrigger: function(id){
		return self.getIPCPath(id)+"/trigger";
	},
	getCleanupHook: function(id){
		return self.getIPCPath(id)+"/cleanup";
	},
	createIpcFs: async function(){
		await invoke(self.mountPath, ["-t", "ramfs", "ramfs", self.ipcRoot]);
		await invoke(self.mountPath, ["--make-shared", self.ipcRoot]); // Make shared on binding app.
	},
	configNetwork: async function(){
		// Forward everything...
		await invoke("iptables", ["-t", "nat", "-A", "POSTROUTING", "-j", "MASQUERADE"]);
		// ...except inter-container communication.
		await invoke("iptables", ["-A", "FORWARD", "--in-interface", "br0", "-d", "10.10.0.0/16", "-j", "DROP"]);

	},
	getNwFile: function(id){
		return self.getIPCPath(id)+"/net";
	},
	destroyIpcFs: async function(){
		// Container-image reference-counting?
		await invoke(self.umountPath, ["-R", self.ipcRoot]);
	},
	createIpc: async function(id){
		const create_folder=await invoke(self.mkdirPath, [self.getIPCPath(id)]);
		const create_ipc_app_mountpoint=await invoke(self.mkdirPath, [self.getAppPath(id)]);
		//const create_trigger=await invoke("mknod", [self.getTrigger(id), "p"])
		//const create_cleanup_hook=await invoke("mknod", [self.getCleanupHook(id), "p"])
	},
	createNetwork: async function(id, pid){
		const create_bridge=await invoke(self.bridgePath, [], {
			"CNI_CONTAINERID": self.getContainerName(id),
			"CNI_NETNS": self.getNetworkNS(pid),
			"CNI_IFNAME": "eth0",
			"CNI_COMMAND": "ADD",
			"CNI_PATH": "/opt/cni/bin",
			"NETCONFPATH": "/opt/cni/netconfs"
		}, self.networkConfig);
		const bridge_config=JSON.parse(create_bridge.stdout);
		await fs.writeFileAsync(self.getNwFile(id), create_bridge.stdout);
		return bridge_config;
	},
	createContainer: async function(id){
		// Create temporary filesystem.
		// Create the container.
		const create_ipc=await self.createIpc(id);
		//console.log("Create container");
		// Using stdin hack to load config after formatting.
		const create_runc=await invoke(self.runcPath, ["run", "-d", "-b", "/runtime", "--pid-file", self.getPIDFile(id), self.getContainerName(id)], null, self.containerConfig.replace("${uid}", id));
		const pid=await fs.readFileAsync(self.getPIDFile(id), "utf-8");
		const bridge_config=JSON.parse(await fs.readFileAsync(self.getNwFile(id), "utf-8"));
		const conn=new LaserContainer(bridge_config.ip4.ip.replace("/16", ":8000"), grpc.credentials.createInsecure());
		const eventhandler=new EventEmitter();
		const cleanup_hook=new Promise(async (resolve)=>{
			const server=net.createServer(client=>{
				client.end();
				server.close();
				resolve();
			});
			server.listen(self.getCleanupHook(id));
		});
		cleanup_hook.then(()=>eventhandler.emit("exit"));
		return {
			"id": id,
			"pid": pid,
			"ip": bridge_config.ip4.ip,
			"rpc": conn, 
			"network_config": bridge_config,
			"cleanup_hook": cleanup_hook,
			"event": eventhandler
		};
	},


	cleanupNetwork: async function(id){
		//const pid=await fs.readFileAsync(self.getPIDFile(id), "utf-8");
		const network_config=JSON.parse(await fs.readFileAsync(self.getNwFile(id), "utf-8"));
		// The cleanup job after a container has been removed.
		const remove_network=await invoke(self.bridgePath, [], {
			"CNI_CONTAINERID": self.getContainerName(id),
			"CNI_NETNS": network_config.ip4.ip,
			"CNI_IFNAME": "eth0",
			"CNI_COMMAND": "DEL",
			"CNI_PATH": "/opt/cni/bin",
			"NETCONFPATH": "/opt/cni/netconfs"
		}, self.networkConfig);
	},

	notifyCleanup: async function(id){
		const notifier=new Promise((resolve)=>{
			const client=net.connect(self.getCleanupHook(id), ()=>{
				resolve();
			});
		});
		await notifier;
	},
	startContainerManager: async function(pool_size){
		const manager={};
		
		const event=new EventEmitter();
		const pool_free=[];
		const image_pool_refcounting={};
		event.on("create", async (id, callback)=>{
			const box=await self.createContainer(id);
			box.state="ready";
			box.cleanup_hook.then(()=>{
			   // If image mounted, unmount image.
			   if(box.state=="running"){
				   await invoke("umount", [self.getAppPath(box.id)]);
				   image_pool_refcounting[box.image]-=1;
			   }
			   // Remove IPC hooks.
			   await invoke("rm", ["-r", self.getIPCPath(box.id)]);
			   // Refill the slot by one.
			   box.event.emit("exit");
			   event.emit("exit", box);
			   event.emit("create", uuid(), (new_box)=>{});
			   
			});
			pool_free.push(box);
			callback(box);
		});
		
		await Promise.all(new Array(pool_size).fill().map(f=>uuid()).map((id)=>new Promise((resolve)=>{
			event.emit("create", id, (box)=>{resolve();});
		})));

		// Connect bridge to internet and disconnect the bridge.
		const setup_network=await self.configNetwork();
		manager.pool=pool_free;
		manager.event=event;
		manager.image_pool=image_pool_refcounting;
		return manager;
	},
	// Get a container from the container pool.
	// This may fail because of container initialization.
	startJob: async function(box, image_path){
		await invoke("squashfuse", [image_path, self.getAppPath(box.id)]);
		box.state="running";
		// Invoke initialization.
		const stream=box.rpc.startFunction();
		stream.write({"Type": "START", "Payload": "start"});
		const wait_ready=await (new Promise((resolve, rejected)=>{
			stream.once("data", (message)=>{
				if(message.Type=="START"){
					resolve();
				}else{ //APP_CRASH: just let it crash and cleanup is done by cleanup_hook.
					rejected(message);
					// Just return initialization failure.
				}
				
			});
		}));
		await wait_ready;
		box.command=stream;

		return box;
	},
	cleanupContainer: async function(box, unmount){
		if(unmount){
			await invoke("umount", [self.getAppPath(box.id)]);
		}
		// Remove IPC hooks.
		await invoke("rm", ["-r", self.getIPCPath(box.id)]);
	}
};

module.exports=self;
