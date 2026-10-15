import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
export function hasSiteBridgeToken(request:Request){
 const expected=String(process.env.PUBLIC_SITE_BRIDGE_TOKEN||'').trim();
 const supplied=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return /^[A-Za-z0-9_-]{32,256}$/.test(expected)&&a.length===b.length&&timingSafeEqual(a,b);
}
export function siteBridgeClientIp(request:Request){
 const ip=request.headers.get('x-site-client-ip')||'';
 return hasSiteBridgeToken(request)&&isIP(ip)?ip:'unknown';
}
