const runc=require('./container');
const fs = require("fs");
const bluebird=require('bluebird');
bluebird.promisifyAll(fs);
async function main(){
    console.log('Container started');
    
    const container = JSON.parse(fs.readFileSync(0, "utf-8"));
    const id=container.id.replace("laser-app-", "");
    const pid=container.pid;
    console.log(container.status)
    fs.writeFileSync("/tmp/"+id+".txt", JSON.stringify(container));
    //process.exit(1);
    switch(container.status){
        case "creating":{
            await runc.createNetwork(id, pid);
            break;
        }
        case "created":{
            break;
        }
        case "running":{
            break;
        }
        case "stopped":{
            fs.writeFileSync("/tmp/1-"+id+".txt", JSON.stringify(container));
            await runc.cleanupNetwork(id);
            fs.writeFileSync("/tmp/2-"+id+".txt", JSON.stringify(container));
            await runc.notifyCleanup(id);
            fs.writeFileSync("/tmp/3-"+id+".txt", JSON.stringify(container));
            break;
        }

    }
    process.exit(0);
}

main().catch((err)=>{fs.writeFileSync("/tmp/error.txt", err);console.log(err);process.exit(1)});