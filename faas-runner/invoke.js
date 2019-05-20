const child_process=require('child_process');
const pipe=require('./pipe');
const fs=require('fs');
const bluebird=require('bluebird');
bluebird.promisifyAll(fs);
module.exports=function(command, args, envs, input){
	return new Promise(async (resolve, rejected)=>{
		try{
			let stdin_source="pipe";
			let pipes;
			if(input){
				pipes=pipe.pipe();
				stdin_source=pipes[0];
			}
			//console.log(pipes);
			const ps=child_process.spawn(command, args, {
				env: envs?Object.assign({}, process.env, envs):process.env, 
				"encoding": "buffer", 
				"detached": true,
				"stdio": [stdin_source, "pipe", "pipe"]
			});
			//console.log(ps);
			if(input){
				(async ()=>{
					//console.log("Start writing");
					await fs.writeAsync(pipes[1], input);
					await fs.closeAsync(pipes[1]);
					//console.log("End writing");
					await fs.closeAsync(pipes[0]);
				})();
			}
			const stdout_buffer=[];
			const stderr_buffer=[];
			ps.stdout.on('data', (data)=>{
				//console.log(data);
				stdout_buffer.push(data);
			});
			ps.stderr.on('data', (data)=>{
				stderr_buffer.push(data);
			});
			ps.on('exit', (code)=>{
				const stdout_result=Buffer.concat(stdout_buffer);
				const stderr_result=Buffer.concat(stderr_buffer);
				const ret={"code": code, "stdout": stdout_result, "stderr": stderr_result, 
				"stdout-str":stdout_result.toString(), "stderr-str": stderr_result.toString()};
				if(code==0){
					resolve(ret);
				}else{
					rejected(ret);
				}
			});
		}catch(err){
			rejected({"error":err});
		}
	});
}
