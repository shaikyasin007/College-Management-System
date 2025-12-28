// Scroll reveal
const onReveal = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.classList.add('show');
      onReveal.unobserve(e.target);
    }
  });
},{threshold:0.15});

document.querySelectorAll('.reveal').forEach(el=>onReveal.observe(el));

// Counters
const q = (sel)=>Array.from(document.querySelectorAll(sel));
const metrics = q('.metric .val');
const counterIO = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    if(!entry.isIntersecting) return;
    const el = entry.target;
    const end = parseInt(el.getAttribute('data-count')||'0',10);
    const suffix = el.getAttribute('data-suffix')||'';
    let start = 0;
    const dur = 1400;
    const t0 = performance.now();
    const step = (t)=>{
      const p = Math.min(1,(t - t0) / dur);
      const eased = 1 - Math.pow(1-p,3);
      const val = Math.round(end * eased);
      el.textContent = suffix ? `${val}${p>=1?suffix:''}` : val;
      if(p<1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    counterIO.unobserve(el);
  });
},{threshold:0.6});
metrics.forEach(el=>counterIO.observe(el));

// Hero background fallback loader
(function(){
  const hero = document.querySelector('.hero');
  if(!hero) return;
  const localSrc = 'assets/campus.jpg';
  const fallback = 'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?q=80&w=2000&auto=format&fit=crop';
  const img = new Image();
  img.src = localSrc + '?v=' + Date.now();
  img.onload = ()=>{ /* local exists - nothing to do (already set inline) */ };
  img.onerror = ()=>{ hero.style.backgroundImage = `url(${fallback})`; };
})();

// Hero particles (Option A: soft drifting dots)
(function(){
  const canvas = document.getElementById('heroParticles');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles;

  function rand(a,b){return Math.random()*(b-a)+a}

  function init(){
    const rect = canvas.getBoundingClientRect();
    w = canvas.width = rect.width * devicePixelRatio;
    h = canvas.height = rect.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const count = Math.max(40, Math.floor((rect.width*rect.height)/18000));
    particles = Array.from({length: count}).map(()=>({
      x: rand(0, rect.width),
      y: rand(0, rect.height),
      r: rand(1, 2.4),
      vx: rand(-0.2, 0.2),
      vy: rand(0.05, 0.25),
      o: rand(0.15, 0.5)
    }));
  }

  function step(){
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);
    for(const p of particles){
      p.x += p.vx; p.y += p.vy;
      if(p.x < -10) p.x = rect.width+10; if(p.x > rect.width+10) p.x = -10;
      if(p.y > rect.height+10) { p.y = -10; p.x = rand(0, rect.width); }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,255,255,${p.o})`;
      ctx.fill();
    }
    requestAnimationFrame(step);
  }

  window.addEventListener('resize', init);
  init();
  requestAnimationFrame(step);
})();

// Simple slider for testimonials
(function(){
  const slider = document.querySelector('[data-slider]');
  if(!slider) return;
  const slides = Array.from(slider.querySelectorAll('.slide'));
  const prev = slider.querySelector('[data-prev]');
  const next = slider.querySelector('[data-next]');
  let i = 0;
  const show = (n)=>{
    slides[i].classList.remove('active');
    i = (n + slides.length) % slides.length;
    slides[i].classList.add('active');
  };
  prev?.addEventListener('click',()=>show(i-1));
  next?.addEventListener('click',()=>show(i+1));
  // autoplay
  setInterval(()=>show(i+1), 5000);
})();

// Accessible ticker (replaces marquee)
(function(){
  const root = document.querySelector('[data-ticker]');
  if(!root) return;
  const list = root.querySelector('.ticker-list');
  const items = Array.from(list.children);
  const btnPrev = root.querySelector('[data-ticker-prev]');
  const btnNext = root.querySelector('[data-ticker-next]');
  let idx = 0, timer;

  function render(){
    // Move active item to front using translate animation effect
    list.style.transition = 'transform .4s ease';
    list.style.transform = `translateX(-${calcOffset(idx)}px)`;
  }

  function calcOffset(n){
    let w = 0;
    for(let j=0;j<n;j++) w += items[j].offsetWidth + 28; // 28px gap in CSS
    return w;
  }

  function next(){ idx = (idx + 1) % items.length; render(); }
  function prev(){ idx = (idx - 1 + items.length) % items.length; render(); }

  function play(){ stop(); timer = setInterval(next, 4000); }
  function stop(){ if(timer) clearInterval(timer); }

  btnNext?.addEventListener('click', next);
  btnPrev?.addEventListener('click', prev);
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', play);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', play);

  // Ensure widths measured
  window.addEventListener('load', ()=>{ render(); play(); });
  window.addEventListener('resize', ()=>{ list.style.transition='none'; render(); });
})();
