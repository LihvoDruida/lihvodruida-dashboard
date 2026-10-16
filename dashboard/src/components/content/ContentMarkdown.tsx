'use client';
import {useDeferredValue} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './content.module.css';
export default function ContentMarkdown({body}:{body:string}){
 const markdown=useDeferredValue(body);
 return <div className={styles.prose}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,table:({children})=><div className={styles.tableScroll}><table>{children}</table></div>,img:({src,alt})=><img src={typeof src==='string'?src:undefined} alt={alt||''} loading="lazy"/>}}>{markdown||'*Тут з’явиться попередній перегляд тексту.*'}</Markdown></div>;
}
