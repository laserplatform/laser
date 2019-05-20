const PROTO_PATH=__dirname+"/proto/faas-runner.proto";
const grpc=require('grpc');
const protoLoader=require("@grpc/proto-loader");
const packageDef=protoLoader.loadSync(PROTO_PATH, {"keepCase": true, "longs": BigInt, "enums": String, "defaults": true, "oneofs": true});
const LaserContainer=grpc.loadPackageDefinition(packageDef).Laser.LaserContainer;

module.exports=LaserContainer;
