// This is the code for the function runtime.
const PROTO_PATH=__dirname+"/proto/faas-runner.proto";
const grpc=require('grpc');
const protoLoader=require("@grpc/proto-loader");
const packageDef=protoLoader.loadSync(PROTO_PATH, {"keepCase": true, "longs": BigInt, "enums": String, "defaults": true, "oneofs": true});
const UUID=require('uuid/v4');
const bluebird=require('bluebird');
const fs=require('fs');
bluebird.promisifyAll(fs);
const proto=grpc.loadPackageDefinition(packageDef).Laser;
// Register the runtime and fetch a task.
//    rpc fetchTask(TaskRequest) returns (stream AppData);
    // Simulating "Stream" behaviour.
//    rpc taskStarted(stream AppRequestChunk) returns (stream AppResponseChunk);
let service_started=false;
let function_handler=null;
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
let shutting_down=0;
let runner;
function onRegister(call){
//    if(container_cache[])
    // Service link is created.
    call.once("data", async function(data){
        if(data.CommandType=="READY"){
            const fork = require('child_process').fork;
            const program = path.resolve('runner.js');
            const parameters = [];
            const options = {
                stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ]
            };
            runner=fork(program, parameters, options);
            runner.on("exit", function(code){
                if(!shutting_down){
                    call.write({"CommandType":"APP_CRASH", "Payload": ""});
                    exit(1);
                }
            });
            const wait_for_loading=new Promise((resolve)=>{
                runner.once("message", function(msg){
                    console.log(msg);
                    resolve();
                });
            });
            await wait_for_loading;
            service_started=true;
            call.write({"CommandType": "READY", "Payload": ""});
        }else
        if(data.CommandType=="HEARTBEAT"){
            call.write({"CommandType": "HEARTBEAT", "Payload": data.Payload});
        }
    });
    
}


// bidi stream
// it is ensured by host scheduler that one task a time.
async function onInvoke(call, callback){
    if(service_started){
        runner.send(call.request.Content);
        const wait_for_output=new Promise((resolve)=>{
            runner.once("message", function(msg){
                resolve(msg);
            });
        });
        call.write({"Content":await wait_for_output});
    }
    call.end();
}

function main(){
    const server=new grpc.Server();
    server.addService(proto.LaserContainer.service, {"startFunction": onRegister, "functionInvoke": onInvoke});
    const passphrase=UUID();
    fs.appendFileSync("/task/trigger", passphrase); // Block the server here to send passphrase;
    server.bind("0.0.0.0:8000", grpc.ServerCredentials.createInsecure());
    server.start();
    const pong=fs.readFileSync("/task/trigger", "utf-8");
    if(pong!=passphrase){
        console.log("Passphrase ping-pong failed! Exiting...");
        process.exit(1);
    }
}


main();

