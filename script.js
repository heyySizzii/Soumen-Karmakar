
/* NAV */
function toggleMenu(){document.getElementById('ham').classList.toggle('open');document.getElementById('mobOverlay').classList.toggle('open')}
function closeMenu(){document.getElementById('ham').classList.remove('open');document.getElementById('mobOverlay').classList.remove('open')}
document.addEventListener('click',e=>{const h=document.getElementById('ham'),m=document.getElementById('mobOverlay');if(!h.contains(e.target)&&!m.contains(e.target))closeMenu()});

/* ACTIVE NAV LINK */
const secs=document.querySelectorAll('section[id]');
const navAs=document.querySelectorAll('.nav-links a:not(.btn-hire)');
window.addEventListener('scroll',()=>{
  let cur='';
  secs.forEach(s=>{if(window.scrollY>=s.offsetTop-90)cur=s.id});
  navAs.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+cur));
  document.getElementById('scrollFab').classList.toggle('show',window.scrollY>400);
},{ passive:true });

/* AOS REVEAL */
const aObs=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      const d=+(e.target.dataset.delay||0);
      setTimeout(()=>e.target.classList.add('in'),d);
      aObs.unobserve(e.target);
    }
  });
},{threshold:.1});
document.querySelectorAll('.aos').forEach(el=>aObs.observe(el));

/* SKILL BARS */
const bObs=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.querySelectorAll('.skill-fill').forEach(b=>setTimeout(()=>b.style.width=b.dataset.w+'%',200));
      e.target.querySelectorAll('.prof-fill').forEach(b=>setTimeout(()=>b.style.width=b.dataset.w+'%',200));
      bObs.unobserve(e.target);
    }
  });
},{threshold:.2});
document.querySelectorAll('.skill-block,.prof-wrap').forEach(el=>bObs.observe(el));

/* TYPED ROLE */
const roles = ['Student', 'Photographer', 'Frontend Developer', 'Video Editor'];
let ri=0,ci=0,del=false;
const tel=document.getElementById('typed-text');
function typeIt(){
  const cur=roles[ri];
  tel.textContent=del?cur.slice(0,ci--):cur.slice(0,ci++);
  let t=del?55:100;
  if(!del&&ci>cur.length){del=true;t=1400}
  if(del&&ci<0){del=false;ri=(ri+1)%roles.length;t=280}
  setTimeout(typeIt,t);
}
setTimeout(typeIt,800);

/* PROJECT FILTER */
document.querySelectorAll('.pf-btn').forEach(btn=>{
  btn.onclick=function(){
    document.querySelectorAll('.pf-btn').forEach(b=>b.classList.remove('active'));
    this.classList.add('active');
    const f=this.dataset.f;
    document.querySelectorAll('.project').forEach(c=>{
      const cat=c.dataset.cat||'';
      c.style.display=(f==='all'||cat.split(' ').includes(f))?'':'none';
    });
  };
});

/* CONTACT FORM */
function submitCF(){
  const fn=document.getElementById('cf-fn').value.trim();
  const em=document.getElementById('cf-em').value.trim();
  const sb=document.getElementById('cf-sb').value.trim();
  const ms=document.getElementById('cf-ms').value.trim();
  if(!fn||!em||!sb||!ms){alert('Please fill all required fields.');return;}
  document.getElementById('cForm').style.display='none';
  document.getElementById('cFormOk').style.display='block';
  const t=document.getElementById('toast');
  t.style.display='block';
  setTimeout(()=>t.style.display='none',4000);
}

/* PARTICLES */
(async()=>{
  if(typeof tsParticles==='undefined')return;
  await tsParticles.load('tsparticles',{
    fullScreen:{enable:false},detectRetina:true,fpsLimit:60,
    interactivity:{
      events:{onClick:{enable:true,mode:'push'},onHover:{enable:true,mode:'bubble'},resize:true},
      modes:{bubble:{distance:350,duration:2,opacity:.6,size:5},push:{quantity:2}}
    },
    particles:{
      color:{value:'#000000'},
      move:{enable:true,speed:1.2,direction:'none',outModes:{default:'out'}},
      number:{density:{enable:true,area:900},value:18,limit:24},
      opacity:{animation:{enable:true,minimumValue:.08,speed:1,sync:false},random:true,value:.5},
      rotate:{animation:{enable:true,speed:4,sync:false},direction:'random',random:true,value:0},
      shape:{
        type:'image',
        image:[
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/html5/html5-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/css3/css3-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vuejs/vuejs-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',width:20,height:20},
          {src:'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg',width:20,height:20},
        ]
      },
      size:{value:20,random:false}
    }
  });
})();

