const tabs=[...document.querySelectorAll('[role="tab"]')];
function activate(tab){for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=!selected;}}
for(const tab of tabs){tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(tabs.indexOf(tab)+1)%tabs.length;if(event.key==='ArrowLeft')next=(tabs.indexOf(tab)+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();activate(tabs[next]);tabs[next].focus();}});}
const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
const system=document.querySelector('.system');
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries){const signal=entry.target.querySelector('.signal');signal.style.animationPlayState=entry.isIntersecting?'running':'paused';}});observer.observe(system);}
