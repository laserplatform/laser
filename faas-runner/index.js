const {Etcd3}=require('etcd3');
const bluebird=require('bluebird');
const etcd=new Etcd3();
const container=require('./contaienr');
const ImagePool=require('./image_pool');
bluebird.promisifyAll(etcd);
//bluebird.promisifyAll(minioClient);
const uuid=require('uuid/v4');
const runner_id=uuid();

async function main(){
    console.log(runner_id);
    const images=new ImagePool();
    //const manager=await container.startContainerManager(10);
    
    // The function to spin up a container with given image_name
    // and lock it with task id.
    async function spinup_and_lock(image_name, task_id){
        // ensure the image exists.
        await images.ensureImage(image_name);
        // Create etcd container.
        const box=await container.startJob(manager, image_name);
        // Notify startup.
        await etcd.put("laser.running-containers."+box.id+".startup");

    }
    await etcd.put("laser.runners."+runner_id+".started");


}

