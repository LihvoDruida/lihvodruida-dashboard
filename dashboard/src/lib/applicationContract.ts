/** Paired site/dashboard contract. Keep this file byte-identical in both releases. */
export const classes=['Warrior','Paladin','Hunter','Rogue','Priest','Death Knight','Shaman','Mage','Warlock','Monk','Druid','Demon Hunter','Evoker'];
const limits={characterName:12,realm:32,faction:16,className:32,discord:32,battleTag:19,availability:1200,sourceCreator:80,sourcePlatform:80,sourceOther:160,source:240,website:200,region:8};
export function normalizeApplication(x:Record<string,unknown>){
 const result:Record<string,string>={};
 for(const key of Object.keys(limits))result[key]=String(x[key]||'').normalize('NFC').replace(/\s+/g,' ').trim();
 result.discord=result.discord.toLowerCase().replace(/^@/,'');result.region=result.region.toLowerCase()||'eu';
 result.source=[result.sourceCreator,result.sourcePlatform,result.sourceOther].filter(Boolean).join(' · ');
 return result;
}
export function validateApplication(x:Record<string,unknown>):string|null{
 for(const [key,max] of Object.entries(limits))if(typeof x[key]!=='undefined'&&typeof x[key]!=='string')return 'Некоректний формат поля заявки.';else if(String(x[key]||'').normalize('NFC').trim().length>max)return 'Одне з полів заявки завелике.';
 const s=normalizeApplication(x);
 if(s.website)return 'Не вдалося надіслати заявку.';
 if(!/^\p{L}{2,12}$/u.test(s.characterName))return 'Ім’я персонажа: 2–12 літер.';
 if(!/^\p{Script=Latin}[\p{Script=Latin}\p{N} '’.()\-]{1,31}$/u.test(s.realm))return 'Перевір назву реалму.';
 if(!['Alliance','Horde'].includes(s.faction)||!classes.includes(s.className))return 'Обери фракцію та клас.';
 if(!/^[a-z0-9._]{2,32}$/.test(s.discord))return 'Вкажи Discord username без @, малими літерами.';
 if((s.faction==='Horde'||s.battleTag)&&!/^\p{L}[\p{L}\p{N}]{2,11}#\d{4,6}$/u.test(s.battleTag))return 'Перевір BattleTag: Name#12345. Для Horde він обов’язковий.';
 if(s.region!=='eu')return 'Підтримується регіон EU.';
 if(s.availability.length<10)return 'Опиши час гри: від 10 до 1200 символів.';
 if(!s.sourceCreator)return 'Вкажи, звідки дізнався про нас.';
 if(s.sourceCreator==='Інше'&&!s.sourceOther)return 'Уточни, звідки дізнався про нас.';
 if(s.sourceCreator!=='Інше'&&!s.sourcePlatform)return 'Обери платформу.';
 if(x.consent!==true&&x.consent!=='on')return 'Підтверди згоду на обробку заявки.';
 return null;
}
