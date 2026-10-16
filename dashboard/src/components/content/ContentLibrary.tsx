'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {SiteContentItem} from '@/lib/content';
import {contentImageUrl,contentPublicUrl} from '@/lib/contentModel';
import {contentRequest,parseContentLibrary} from './client';
import styles from './content.module.css';
export default function ContentLibrary({initial,siteUrl}:{initial:SiteContentItem[];siteUrl:string}){
 const [items,setItems]=useState(initial),[query,setQuery]=useState(''),[kind,setKind]=useState('all'),[status,setStatus]=useState('all'),[sort,setSort]=useState('updated'),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState('');
 const active=useRef(false),mounted=useRef(false),controller=useRef<AbortController|null>(null);
 async function refresh(){
  if(active.current)return;active.current=true;controller.current=new AbortController();const signal=controller.current.signal;setLoading(true);
  try{const data=parseContentLibrary(await contentRequest<unknown>('/api/content/list',{signal}));if(mounted.current&&!signal.aborted){setItems(data.items);setChecked(data.checkedAt);setError('');}}
  catch(e){if(mounted.current&&!signal.aborted)setError(e instanceof Error?e.message:'Не вдалося оновити список.');}
  finally{active.current=false;if(mounted.current&&!signal.aborted)setLoading(false);}
 }
 useEffect(()=>{mounted.current=true;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();},60000);return()=>{mounted.current=false;clearInterval(timer);controller.current?.abort();};},[]);
 const filtered=useMemo(()=>{const q=query.trim().toLocaleLowerCase('uk-UA');return items.filter(item=>(kind==='all'||item.kind===kind)&&(status==='all'||item.status===status)&&(!q||[item.title,item.description,item.author,item.tags,item.categories,item.slug].join(' ').toLocaleLowerCase('uk-UA').includes(q))).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'uk-UA'):((sort==='date'?b.date:(b.updated_at||b.last_modified_at)).localeCompare(sort==='date'?a.date:(a.updated_at||a.last_modified_at))||a.title.localeCompare(b.title,'uk-UA')));},[items,query,kind,status,sort]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/15)),current=Math.min(page,totalPages),visible=filtered.slice((current-1)*15,current*15);
 const published=items.filter(i=>i.status==='published').length;
 function reset(){setQuery('');setKind('all');setStatus('all');setSort('updated');setPage(1);}
 return <div className={styles.workspace}>
  <div className={styles.stats}><div><strong>{items.length}</strong><span>Усі матеріали</span></div><div><strong>{published}</strong><span>Опубліковано</span></div><div><strong>{items.length-published}</strong><span>Чернетки</span></div><div><strong>{items.filter(i=>i.kind==='guides').length}</strong><span>Гайди</span></div></div>
  <section className={`panel dashboard-list-panel ${styles.library}`} aria-label="Бібліотека матеріалів">
   <div className={styles.sectionHead}><div><span className="eyebrow">Бібліотека</span><h2>Матеріали сайту</h2></div><div className={styles.actions}><button className="btn subtle" onClick={()=>void refresh()} disabled={loading}>{loading?'Оновлюємо…':'Оновити список'}</button><a className="btn primary" href="/content?new=1">Новий матеріал</a></div></div>
   <div className={styles.filters}><label className={styles.search}>Пошук<input type="search" className="input" value={query} maxLength={120} placeholder="Заголовок, автор, теги…" onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label><label>Тип<select aria-label="Тип матеріалів" className="select" value={kind} onChange={e=>{setKind(e.target.value);setPage(1);}}><option value="all">Усі типи</option><option value="news">Новини</option><option value="guides">Гайди</option></select></label><label>Стан<select aria-label="Стан матеріалів" className="select" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">Усі стани</option><option value="published">Опубліковано</option><option value="draft">Чернетки</option></select></label><label>Порядок<select aria-label="Порядок матеріалів" className="select" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="updated">Нещодавно оновлені</option><option value="date">За датою публікації</option><option value="title">За заголовком</option></select></label></div>
   <div className={styles.listMeta}><span>Знайдено: {filtered.length} із {items.length}</span>{query||kind!=='all'||status!=='all'?<button className="btn subtle" onClick={reset}>Скинути фільтри</button>:null}<span>{checked?'Перевірено '+new Date(checked).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):'Список оновлюється у фоні'}</span></div>
   {error?<p className={styles.error} role="alert">{error} Попередній список збережено.</p>:null}
   <div className={styles.rows} aria-busy={loading}>{visible.map(item=><article key={item.path} className={`dashboard-list-row ${styles.row}`}>
    <a className={styles.thumbnail} href={`/content?edit=${encodeURIComponent(item.path)}`} tabIndex={-1} aria-hidden="true">{item.image?<img src={contentImageUrl(item.image,siteUrl)} alt="" loading="lazy"/>:<span>✦</span>}</a>
    <div className={styles.rowCopy}><div className={styles.badges}><span className={item.status==='published'?styles.published:styles.draft}>{item.status==='published'?'Опубліковано':'Чернетка'}</span><span>{item.kind==='news'?'Новина':'Гайд'}</span></div><a className={styles.rowTitle} href={`/content?edit=${encodeURIComponent(item.path)}`}>{item.title}</a><p>{item.description||'Опис ще не додано'}</p><small>{item.author||'Без автора'} · <time dateTime={item.last_modified_at}>{item.last_modified_at}</time>{item.tags?' · '+item.tags:''}</small></div>
    <div className={`dashboard-list-actions ${styles.rowActions}`}><a className="btn subtle" href={`/content?edit=${encodeURIComponent(item.path)}`}>Редагувати</a>{item.status==='published'?<a className="btn ghost" href={contentPublicUrl(item.kind,item.slug,siteUrl)} target="_blank" rel="noopener noreferrer">На сайті ↗</a>:null}</div>
   </article>)}</div>
   {!visible.length?<div className={styles.empty}><h3>{items.length?'Нічого не знайдено':'Створи перший матеріал'}</h3><p>{items.length?'Зміни пошук або скинь фільтри.':'Почни з чернетки новини чи гайда та опублікуй, коли буде готово.'}</p>{items.length?<button className="btn subtle" onClick={reset}>Скинути фільтри</button>:<a className="btn primary" href="/content?new=1">Створити матеріал</a>}</div>:null}
   <nav className={styles.pagination} aria-label="Сторінки матеріалів"><button className="btn subtle" disabled={current<=1} onClick={()=>setPage(current-1)}>← Назад</button><span>Сторінка {current} із {totalPages}</span><button className="btn subtle" disabled={current>=totalPages} onClick={()=>setPage(current+1)}>Далі →</button></nav>
  </section>
 </div>;
}
