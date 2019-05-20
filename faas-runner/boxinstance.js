const container=require('./container');
const {Etcd3}=require('etcd3');
const bluebird=require('bluebird');
const etcd=new Etcd3();
bluebird.promisifyAll(etcd);
const uuid=require('uuid/v4');
const invoke=require('invoke');
class BoxInstance{
    constructor(image_manager){
        this.state="uninitialized";
        this.image_manager=image_manager;
    }
    getID(){
        return this.box.id;
    }
    async spinup(){
        const self=this;
        this.box=await container.createContainer(uuid());
        this.box.event.on("exit", async()=>{
            await self.cleanup();
        })
        this.state="init";
        //register some events.
        const occupy_lock="laser.free_containers."+this.box.id;
        const task_lock="laser.grabbed_containers."+this.box.id;
        const differenciate_log="laser.differenciate_log."+this.box.id;
        const watcher=await etcd.watch().key(occupy_lock).create();
        watcher.on('put', (res, prev)=>{
            const val=res.value.toString();
            if(prev.value.toString()=="0"){
                // This is a lock operation.
                const lock_op=JSON.parse(val);
                //Delete the key.
                await etcd.delete().key(occupy_lock);
                await watcher.cancel();
                let image_id=lock_op.image_id;
                if(!image_id){
                    // this is a pre-grabbed container.
                    image_id=await new Promise((resolve)=>{
                        const grab_watcher=await etcd.watch().key(task_lock).create();
                        grab_watcher.once('put', res=>{
                            resolve(res.value.toString());
                            // self-cleanup.
                            await grab_watcher.cancel();
                        });
                    });
                }
                let task_id=lock_op.task_id;
                // In any case, the runner knows the image and starts to differenciate.
                try{
                    await self.startImage(image_id);
                    await etcd.put(differenciate_log).value(JSON.stringify({"result":"success"}));
                    
                }catch(err){
                    await etcd.put(differenciate_log).value(JSON.stringify({"result":"failed"}));
                    return;
                }
                self.imaged_occupy_lock="laser.loaded_functions."+image_id+"."+self.box.id;
                if(task_id){
                    // Some task is specified.
                    // So do the task first.
                    await solveTask(task_id);
                }
                self.task_watcher=await etcd.watch().key(self.imaged_occupy_lock).create();
                self.task_watcher.on("put", (res, prev)=>{
                    const val=res.value.toString();
                    if(prev.value.toString()=="0"){
                        // A lock on imaged_occupy_lock.
                        // Solve task here.
                        await solveTask(val);
                        // and reset the lock.
                        await etcd.put(self.imaged_occupy_lock).value("0");
                    }
                });
                await etcd.put(self.imaged_occupy_lock).value("0");
            }
        });
        // unlock now to start the container.
        await etcd.put(occupy_lock).value("0");
        
    }
    async solveTask(task_id){
        //TODO: pricing can be done here.
        const task=await etcd.get("laser.tasks."+task_id).json();
        if(task.response) return; //This should not happen.
        const req=task.request;
        const func=await this.box.rpc.functionInvoke({"Content": req});
        const response=await new Promise((resolve)=>{
            func.once('data', (obj)=>{
                func.close();
                resolve(obj)
            });
        });
        Object.assign(task, {"response": JSON.parse(response)});
        await etcd.put("laser.tasks."+task_id).value(JSON.stringify(task));
    }
    async startImage(image_id){
        this.state="running";
        await container.startJob(self.box, image_id);
    }
    async cleanup(){
        const remover=etcd.delete()
        .key("laser.free_containers."+this.box.id)
        .key("laser.grabbed_containers."+this.box.id)
        .key("laser.differenciate_log."+this.box.id);
        if(this.imaged_occupy_lock){
            remover=remover.key(this.imaged_occupy_lock);
        }
        // Remove all related keys.
        await remover.exec();
        await container.cleanupContainer(rhis.box, this.box.state=="running");
    }


};