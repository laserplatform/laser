const libsys=require('libsys');
const SYS_pipe2=293;

module.exports={
    "pipe":function(){
        const buf=Buffer.alloc(10);
        libsys.syscall(SYS_pipe2, buf, 0x80000);
        return [buf.readInt32LE(0), buf.readInt32LE(4)];
    }
}