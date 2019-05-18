const container=require('./container');
const fs = require("fs");

async function main(){
    const container = JSON.parse(fs.readFileSync(0, "utf-8"));
    const id=container.id;
    const pid=container.pid;
    switch(container.status){
        case "creating":
            await container.createNetwork(id, pid);
            break;
        case "created":
            break;
        case "running":
            break;
        case "stopped":
            await container.cleanupNetwork(id, pid);
            await container.notifyCleanup();
            break;

    }
    process.exit(0);
}

main();