import {redirect} from 'next/navigation';
import {getSession} from '@/lib/auth';
import {canManageStreamers} from '@/lib/streamers/contract';
import DashboardIdentity from '@/components/DashboardIdentity';
import AdminPageHeader from '@/components/AdminPageHeader';
import AdminTabs from '@/components/AdminTabs';
import StreamerSettings from '@/components/streamers/StreamerSettings';
import {buildPageMetadata} from '@/lib/seo';
import './streamers.css';
export const dynamic='force-dynamic';
export const metadata=buildPageMetadata({title:'Стрімери гільдії',description:'Канали учасників, трансляції на сайті та сповіщення Discord.',path:'/dashboard/streamers'});
export default async function StreamersPage(){const user=await getSession({live:true});if(!user)redirect('/login?next=%2Fdashboard%2Fstreamers');if(!canManageStreamers(user))redirect('/access-denied?reason=admin&from=/dashboard/streamers');return <main className="container app-page admin-container"><div className="dashboard-shell content-shell admin-workspace app-page-stack"><DashboardIdentity user={user} activeSection="admin"/><AdminPageHeader eyebrow="Mistblossom Vanguard · Медіа" title="Стрімери гільдії" description="Канали учасників, підтверджені ефіри й нові відео."/><AdminTabs active="streamers" user={user}/><StreamerSettings/></div></main>;}
