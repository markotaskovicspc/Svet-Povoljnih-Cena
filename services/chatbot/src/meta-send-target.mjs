// Facebook Login uses the linked Page's Send API; Instagram Login uses the IG account.
export function metaSendTarget(account, accounts) {
  if(account.channel==='instagram' && account.login==='facebook') {
    const pageId=account.pageId ?? accounts.find(a=>a.channel==='facebook' && a.token===account.token)?.id;
    if(!/^\d+$/.test(pageId??''))throw new Error('INSTAGRAM_LINKED_PAGE_REQUIRED');
    return {host:'graph.facebook.com',id:pageId};
  }
  return {host:account.login==='instagram'?'graph.instagram.com':'graph.facebook.com',id:account.id};
}
