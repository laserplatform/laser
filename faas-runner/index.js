const PROTO_PATH=__dirname+"/proto/fast-runner.proto";

const grpc=require('grpc');
const protoLoader=require("@grpc/proto-laoder");
const packageDef=protoLoader.loadSync(PROTO_PATH, {"keepCase": true, "longs": BigInt, "enums": String, "defaults": true, "oneofs": true});
const UUID=require('uuid/v4');

const proto=grpc.loadPackageDefinition(packageDef).Laser;
// Register the runtime and fetch a task.
//    rpc fetchTask(TaskRequest) returns (stream AppData);
    // Simulating "Stream" behaviour.
//    rpc taskStarted(stream AppRequestChunk) returns (stream AppResponseChunk);
let container_cache={};

async function createContainer(){
    // TODO: call the runC to create a container with some secret.
    let uuid=UUID();
    console.log("Debug: a container called "+uuid+"  has been created.");
    container_cache[uuid]={
        "state": "starting",
    };
    const wait_for_register=new Promise((resolve)=>{
        container_cache[uuid]["waiter"]=resolve;
    });
    await wait_for_register;
    
}

function onRegister(call, callback){
    if(container_cache[])
}


// bidi stream
function onTaskStarted(call){

}

function main(){
    const server=new grpc.Server();
    server.addService(proto.FaaSRunner.service, {fetchTask: onFetchTask, taskStarted: onTaskStarted});
    server.bind("10.144.0.1:50051", grpc.ServerCredentials.createInsecure());
    server.start();
}


main();
