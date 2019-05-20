const Minio = require('minio')

// Instantiate the minio client with the endpoint
// and access keys as shown below.
const minioClient = new Minio.Client({
    endPoint: '127.0.0.1',
    port: 9000,
    //useSSL: true,
    accessKey: 'L4WXOJBJ5KI85BRTHB0D',
    secretKey: 'nxZR3e6P+RxMaVYv0h6krOTEsV005TlS+e0axV8+'
});

class ImagePool{
    constructor(){
        self.image_pool={};
    }
    async ensureImage(image_id){
        if(self.image_pool[image_id]){
            await self.image_pool[image_id].hook;
        }else{
            self.image_pool[image_id]={
                "hook": minioClient.fGetObject("laser", image_name, "/apps/"+image_name),
                "counter": 0
            };
        }
    }
};
module.exports=ImagePool;