// This is the code for the function runtime.
const PROTO_PATH=__dirname+"/proto/faas-runner.proto";
const grpc=require('grpc');
const protoLoader=require("@grpc/proto-loader");
const packageDef=protoLoader.loadSync(PROTO_PATH, {"keepCase": true, "longs": BigInt, "enums": String, "defaults": true, "oneofs": true});
const UUID=require('uuid/v4');
const bluebird=require('bluebird');
const fs=require('fs');
const path=require('path');
bluebird.promisifyAll(fs);
const process=require('process');
const proto=grpc.loadPackageDefinition(packageDef).Laser;
// Register the runtime and fetch a task.
//    rpc fetchTask(TaskRequest) returns (stream AppData);
    // Simulating "Stream" behaviour.
//    rpc taskStarted(stream AppRequestChunk) returns (stream AppResponseChunk);
let service_started=false;
let function_handler=null;

let shutting_down=0;
let runner;
function onRegister(call){
//    if(container_cache[])
    // Service link is created.
    call.on("data", async function(data){
        console.log(data);
        if(data.Type=="START"){
            if(service_started) return;
            const fork = require('child_process').fork;
            const program = path.resolve('sidecar.js');
            const parameters = [];
            const options = {
                stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ]
            };
            runner=fork(program, parameters, options);
            runner.on("exit", function(code){
                if(!shutting_down){
                    call.write({"Type":"APP_CRASH", "Payload": ""});
                    process.exit(1);
                }
            });
            //console.log("wait 4 msg");
            const wait_for_loading=new Promise((resolve)=>{
                runner.once("message", function(msg){
                    console.log(msg);
                    resolve();
                });
            });
            await wait_for_loading;
            service_started=true;
            call.write({"Type": "START", "Payload": "ready"});
        }else
        if(data.Type=="HEARTBEAT"){
            call.write({"Type": "HEARTBEAT", "Payload": data.Payload});
        }
    });
    call.on('close', function(){
        process.exit(1);
    });
}


// bidi stream
// it is ensured by host scheduler that one task a time.
async function onInvoke(call, callback){
    if(service_started){
        //console.log(call.request.Content)
        runner.send(call.request.Content);
        const wait_for_output=new Promise((resolve)=>{
            runner.once("message", function(msg){
                resolve(msg);
            });
        });
        const data=await wait_for_output;
        //console.log(data);
        call.write({"Content":data});
    }
    call.end();
}

function main(){
    const server=new grpc.Server();
    server.addService(proto.LaserContainer.service, {"startFunction": onRegister, "functionInvoke": onInvoke});
    server.bind("0.0.0.0:8000", grpc.ServerCredentials.createInsecure());
    server.start();
}


main();

