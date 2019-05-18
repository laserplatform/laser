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
		const create_trigger=await invoke("mknod", [self.getTrigger(id), "p"])
		const create_cleanup_hook=await invoke("mknod", [self.getCleanupHook(id), "p"])
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
		await fs.writeFile(self.getNwFile(id), create_bridge.stdout);
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
		const bridge_config=await fs.readFileAsync(self.getNwFile(id), "utf-8");
		// Create the network for container
		// read the pipe to get the passphrase.
		const passphrase=await fs.readFileAsync(self.getTrigger(id), "utf-8");

		// now server has started.
		await fs.appendFileAsync(self.getTrigger(id), passphrase);

		const conn=new LaserContainer(bridge_config.ip4.ip.replace("/16", ":8000"), grpc.credentials.createInsecure());
		const cleanup_hook=new Promise(async (resolve)=>{
			const data=await fs.readFileAsync(self.getCleanupHook(id), "utf-8");
			// Ignore the data. We only need to know that a cleanup is required.
			resolve();
		});
		return {
			"id": id,
			"pid": pid,
			"ip": bridge_config.ip4.ip,
			"rpc": conn, 
			"network_config": bridge_config,
			"cleanup_hook": cleanup_hook
		};
	},


	cleanupNetwork: async function(id, pid){
		// The cleanup job after a container has been removed.
		const remove_network=await invoke(self.bridgePath, [], {
			"CNI_CONTAINERID": id,
			"CNI_NETNS": self.getNetworkNS(pid),
			"CNI_IFNAME": "eth0",
			"CNI_COMMAND": "DEL",
			"CNI_PATH": "/opt/cni/bin",
			"NETCONFPATH": "/opt/cni/netconfs"
		}, self.networkConfig);
	},

	notifyCleanup: async function(id){
		return appendFileAsync(self.getCleanupHook(id), "0");
	},
	startContainerManager: async function(pool_size){
		const pool=await Promise.all(new Array(pool_size).fill().map(f=>uuid()).map(id=>{
			return self.createContainer(id);
		}));
		// Connect bridge to internet and disconnect the bridge.
		const setup_network=await self.configNetwork();
		return {
			pool_free:pool,
			pool_allocated:[],

		}
	},

	
	// Get a container from the container pool.
	fetchContainer: async function(){

	}
};

module.exports=self;
