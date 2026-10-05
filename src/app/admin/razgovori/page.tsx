import {ConversationWorkspace,type Conversation,type Detail} from './workspace';
import {requireAdminAction} from '@/lib/admin';
import {PageHeader} from '@/components/admin/page-header';

export const dynamic='force-dynamic';
export const metadata={title:'Razgovori | SPC',robots:{index:false,follow:false}};
async function read<T>(path:string):Promise<T>{
 const secret=process.env.SOCIAL_INTEGRATION_SECRET;
 if(!secret||secret.length<32||secret.startsWith('GET_FROM_'))throw Error('CHAT_UNAVAILABLE');
 const response=await fetch(new URL(path,'https://spc-chatbot-production.up.railway.app'),{headers:{authorization:`Bearer ${secret}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('CHAT_UNAVAILABLE');return response.json();
}
const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
export default async function ConversationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireAdminAction(['OPS']);const params=await searchParams;
 const selected=first(params.conversation),requested=first(params.channel),channel=['facebook','instagram','web'].includes(requested??'')?requested:'';
 const offset=Number(first(params.offset)??0),historyOffset=Number(first(params.historyOffset)??0);
 const listOffset=Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000?offset:0;
 const messageOffset=Number.isSafeInteger(historyOffset)&&historyOffset>=0&&historyOffset<=1000000?historyOffset:0;
 let list:{items:Conversation[],nextOffset:number|null}|null=null,detail:Detail|null=null,error=false;
 try{[list,detail]=await Promise.all([read<{items:Conversation[],nextOffset:number|null}>(`/operator/conversations?offset=${listOffset}${channel?'&channel='+channel:''}`),selected&&selected.length<=200?read<Detail>('/operator/conversation?id='+encodeURIComponent(selected)+'&offset='+messageOffset):Promise.resolve(null)]);}catch{error=true;}
 return <><PageHeader title="Razgovori kupaca" description="Sva komunikacija na jednom mestu." crumbs={[{href:'/admin',label:'Admin'},{label:'Razgovori'}]}/><ConversationWorkspace list={list} detail={detail} error={error} selected={selected??''} channel={channel??''} listOffset={listOffset} messageOffset={messageOffset}/></>;
}
