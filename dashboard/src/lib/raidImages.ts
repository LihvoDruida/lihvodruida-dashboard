import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
export type RaidImageAsset={name:string;path:string;url:string;downloadUrl?:string|null;htmlUrl?:string|null;size?:number|null};
export async function listRaidImageAssets():Promise<RaidImageAsset[]>{
 const directory='assets/img/raids-img';
 const files=await readdir(path.join(process.cwd(),'public',directory));
 return Promise.all(files.filter(name=>/^[a-z0-9._-]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(name)).sort().map(async name=>({name,path:`${directory}/${name}`,url:`/${directory}/${name}`,size:(await stat(path.join(process.cwd(),'public',directory,name))).size})));
}
