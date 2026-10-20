import {safeMediaImage,type StreamPlatform,type StreamMedia} from './contract';
export function streamerDiscordMessage(event:{memberName:string;platform:StreamPlatform;kind:'live'|'video';media:StreamMedia},nonce:string){
 const platform=event.platform==='twitch'?'Twitch':event.platform==='youtube'?'YouTube':'TikTok';
 const image=safeMediaImage(event.platform,event.media.thumbnailUrl);
 const fields=[{name:'Платформа',value:platform,inline:true},...(event.media.game?[{name:'Гра / категорія',value:event.media.game.slice(0,100),inline:true}]:[]),...(event.kind==='live'&&Number.isSafeInteger(event.media.viewers)&&Number(event.media.viewers)>=0?[{name:'Зараз дивляться',value:String(event.media.viewers),inline:true}]:[])];
 return {nonce,enforce_nonce:true,allowed_mentions:{parse:[],users:[],roles:[],replied_user:false},embeds:[{title:`${event.memberName} ${event.kind==='live'?'вже наживо':'опублікував нове відео'}`.slice(0,200),description:event.media.title.slice(0,300),url:event.media.url,color:event.platform==='twitch'?0x9146ff:event.platform==='youtube'?0xff0033:0x25f4ee,fields,...(image?{image:{url:image}}:{}),footer:{text:platform},timestamp:event.media.publishedAt}],components:[{type:1,components:[{type:2,style:5,label:event.kind==='live'?'Дивитися трансляцію':'Дивитися відео',url:event.media.url}]}]};
}
