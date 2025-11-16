<!doctype html>
<html lang="en" data-vapid="BPS3XpWDobMXOTVRDw_qBGnI8ALo5dXS-dlBJS9efCrqK9qKH5HLyBezA0N_4iqkO3ds2f8DJU_JW4P8p6pmB64">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <title>PastaPass — Mobile</title>

  <!-- PWA basics -->
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1b8f3a">
  <script>
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js");
    }
  </script>

  <!-- Firebase Web SDK (modular) + push registration -->
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
    import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging.js";

    const firebaseConfig = {
      apiKey: "AIzaSyAEXhG7UrzHhdVDl6ydsjurZPOmQ2hl2bE",
      authDomain: "pastapass-4127a.firebaseapp.com",
      projectId: "pastapass-4127a",
      storageBucket: "pastapass-4127a.firebasestorage.app",
      messagingSenderId: "93101930941",
      appId: "1:93101930941:web:fb85697b445e691c073ad4",
      measurementId: "G-YZ7FP3RTV4"
    };

    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    async function ensureFCMRegistered() {
      try {
        const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        if (!('Notification' in window)) return;
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;

        const publicKey = document.documentElement.dataset.vapid;
        const token = await getToken(messaging, { vapidKey: publicKey, serviceWorkerRegistration: swReg });
        if (!token) return;

        const identifier = localStorage.getItem('pastapass_id') || '';
        if (!identifier) return;

        await fetch('/api/push/register', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            identifier,
            token,
            platform: /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' :
                      /android/i.test(navigator.userAgent) ? 'android' : 'web'
          })
        });

        onMessage(messaging, payload => {
          const n = payload?.notification;
          if (n?.title) alert(`${n.title}\n${n.body || ''}`);
        });
      } catch (e) {
        console.log('FCM register error', e);
      }
    }
    window._ensureFCMRegistered = ensureFCMRegistered;
  </script>

  <link rel="icon" href="/assets/logo.png">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800;900&display=swap" rel="stylesheet">
  <style>
    :root{ --green:#1b8f3a; --white:#ffffff; --red:#d32f2f; --gold:#f1c40f }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:Montserrat,system-ui,-apple-system,Segoe UI,Roboto,Arial;
      background:linear-gradient(90deg,var(--green) 0 33.33%, var(--white) 33.33% 66.66%, var(--red) 66.66% 100%);
      min-height:100vh; display:flex; flex-direction:column; align-items:center;
    }
    header{padding:16px 8px; text-align:center}
    header img{width:min(90vw,540px); height:auto; display:inline-block; background:none; filter:none}
    .card{
      width:100%; max-width:560px; background:#111; color:#eee;
      border:1px solid #ffffff22; border-radius:18px; padding:16px; margin:12px;
    }
    label{display:block; margin:10px 0 6px; font-weight:800}
    input{width:100%; padding:12px; border-radius:10px; border:1px solid #444; background:#181818; color:#fff}
    button{margin-top:12px; padding:12px 16px; border:0; border-radius:12px; background:#fff; color:#000; font-weight:900; width:100%}
    .muted{color:#bbb; font-size:13px}

    .plates{
      display:grid !important;
      grid-template-columns:repeat(5,44px)!important;
      grid-auto-rows:44px!important;
      gap:10px!important;
      margin-top:6px;
      justify-content:center;
      align-content:center;
    }
    .plate{
      width:44px; height:44px;
      border-radius:50%; background:#000; border:1px solid #555;
      display:grid; place-items:center;
    }
    .plate svg{width:26px;height:26px}
    .plate .pasta{fill:#7a7a7a}
    .plate.earned .pasta{fill:var(--gold)}

    .toast{
      position: fixed;
      top: -120px; left: 50%; transform: translateX(-50%);
      width: min(92vw, 560px);
      background: #111; color: #f3f3f3;
      border: 1px solid #ffffff22; border-radius: 14px;
      padding: 12px 16px; z-index: 9999;
      box-shadow: 0 10px 30px rgba(0,0,0,.5);
      display: flex; align-items: start; gap: 10px;
      transition: top .35s ease;
    }
    .toast.show{ top: 14px; }
    .toast .icon{ font-size: 22px; line-height: 1; margin-top: 2px; }
    .toast .content{ font-size: 14px; }
    .toast .close{ margin-left: auto; border:0; background:transparent; color:#aaa; font-size:18px; cursor:pointer; }
  </style>
</head>
<body>
  <!-- Geofence Toast -->
  <div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>

  <header><img src="/assets/logo.png" alt="logo"></header>

  <div class="card" id="signupCard">
    <p class="muted">🍝 PastaPass 10+1 — buy 10 pastas, get 1 free!</p>
    <label>Name</label><input id="name" placeholder="Your name">
    <label>Email</label><input id="email" placeholder="your@email.com">
    <label>Phone</label><input id="phone" placeholder="+358 ...">
    <button id="joinBtn">Join PastaPass</button>
    <div id="out" class="muted" style="margin-top:10px;"></div>
  </div>

  <div class="card" id="walletCard" style="display:none">
    <div class="muted">Your PastaPass</div>
    <div id="plates" class="plates" aria-live="polite"></div>
    <div id="reward" class="muted" style="margin-top:8px;"></div>

    <!-- One-button “Add to Home Screen” -->
    <div class="a2hs" style="margin-top:12px;">
      <button id="a2hsBtn" style="width:100%;padding:12px 16px;border:0;border-radius:12px;background:#1b8f3a;color:#fff;font-weight:900;">
        Add to Home Screen
      </button>
    </div>
  </div>

  <script>
    // ===== Identifier stored in localStorage + cookie to avoid “forgetting” =====
    function setCookie(name, value, days = 365) {
      const d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
      document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
    }
    function getCookie(name) {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\\]\\/+^])/g,'\\$1') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    }
    function getIdentifier(){ return localStorage.getItem('pastapass_id') || getCookie('pastapass_id') || ''; }
    function setIdentifier(id){ if(!id) return; localStorage.setItem('pastapass_id', id); setCookie('pastapass_id', id); }

    // API base
    const API = ''; // same origin; Render serves API and web together

    // SVG icon for plates
    const pastaSVG = `<svg viewBox="0 0 24 24"><path class="pasta" d="M4 12c0-3.3 3.1-6 6.9-6 2.1 0 4 .8 5.2 2 .3.3.3.8 0 1.1-.3.3-.8.3-1.1 0-1-1-2.5-1.6-4.1-1.6-3 0-5.4 1.9-5.4 4.3s2.4 4.3 5.4 4.3c1.6 0 3.1-.6 4.1-1.6.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1-1.2 1.2-3.1 2-5.2 2C7.1 18 4 15.3 4 12zM14 8c.4 0 .8.3.8.8S14.4 9.5 14 9.5s-.8-.3-.8-.8.3-.7.8-.7zm2.8 3.2c.4 0 .8.3.8.8s-.3.8-.8.8-.8-.3-.8-.8.4-.8.8-.8z"/></svg>`;

    // DOM refs
    const signupCard=document.getElementById('signupCard');
    const walletCard=document.getElementById('walletCard');
    const platesEl=document.getElementById('plates');
    const out=document.getElementById('out');
    const rewardEl=document.getElementById('reward');
    const joinBtn=document.getElementById('joinBtn');
    const toast=document.getElementById('toast');
    const tokenFromQR=decodeURIComponent(location.hash.slice(1)||'');

    function renderPlates(n){
      platesEl.innerHTML='';
      for(let i=0;i<10;i++){
        const d=document.createElement('div');
        d.className='plate'+(i<n?' earned':'');
        d.innerHTML=pastaSVG;
        platesEl.appendChild(d);
      }
    }
    function stripHashOnce(){ const clean = location.origin + location.pathname + location.search; history.replaceState(null, "", clean); }

    async function apiSignup(payload){
      const r=await fetch(`${API}/api/signup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const j=await r.json(); if(!r.ok) throw new Error(j.error||'signup failed'); return j;
    }
    async function apiAddStamp(identifier){
      const r=await fetch(`${API}/api/stamps/add`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier})});
      const j=await r.json(); if(!r.ok) throw new Error(j.error||'add stamp failed'); return j;
    }

    function showWallet(stamps=0){
      signupCard.style.display='none';
      walletCard.style.display='block';
      renderPlates(stamps);
    }

    // A2HS prompt (Android) + simple instruction for iOS
    let deferredPrompt=null;
    const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
    document.getElementById('a2hsBtn')?.addEventListener('click', async () => {
      if (isStandalone()) return;
      if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
      else alert('On iPhone: Share → Add to Home Screen');
    });

    // ===== INIT =====
    (async function init(){
      const stored=getIdentifier();
      if(stored){
        // if scanning via QR (we use #token in older flows), just add a stamp for this identifier
        if(tokenFromQR){
          try{
            const j=await apiAddStamp(stored);
            showWallet(j.stamps||0);

            if (j.redeemed) {
              out.textContent = '✅ Free pasta redeemed! Your card has been reset.';
              rewardEl.textContent = '';
            } else if (j.ready) {
              out.textContent = '🎉 Congratulations! You have a FREE pasta waiting. Show this to staff and scan once more to redeem.';
              rewardEl.textContent = '🎉 Free pasta available';
            } else {
              out.textContent = 'Stamp added!';
              rewardEl.textContent = '';
            }
            stripHashOnce();
          }catch(e){
            out.textContent='Could not add stamp: '+e.message;
            showWallet(0);
            stripHashOnce();
          }
        }else{
          // just show wallet
          showWallet(0);
        }
        // register for pushes
        if ('Notification' in window) {
          window._ensureFCMRegistered && window._ensureFCMRegistered();
        }
      }else{
        signupCard.style.display='block';
        walletCard.style.display='none';
      }
    })();

    // SIGNUP → store identifier in localStorage + cookie; if QR present, add stamp
    joinBtn.addEventListener('click',async()=>{
      const name=document.getElementById('name').value.trim()||null;
      const email=document.getElementById('email').value.trim()||null;
      const phone=document.getElementById('phone').value.trim()||null;
      const identifier=email||phone;
      if(!identifier){out.textContent='Please enter an email or phone.';return;}
      out.textContent='Creating your PastaPass…';
      try{
        const signupRes=await apiSignup({name,email,phone});
        setIdentifier(identifier);
        let stamps=signupRes.wallet?.stamps||0;

        if(tokenFromQR){
          try{
            const j=await apiAddStamp(identifier);
            stamps=j.stamps||stamps;

            if (j.redeemed) {
              out.textContent = '✅ Free pasta redeemed! Your card has been reset.';
              rewardEl.textContent = '';
            } else if (j.ready) {
              out.textContent = '🎉 Congratulations! You have a FREE pasta waiting. Show this to staff and scan once more to redeem.';
              rewardEl.textContent = '🎉 Free pasta available';
            } else {
              out.textContent = 'Welcome! Stamp added.';
              rewardEl.textContent = '';
            }
            stripHashOnce();
          }catch(e){
            out.textContent='Signed up. Could not add stamp: '+e.message;
            rewardEl.textContent = '';
            stripHashOnce();
          }
        }else{
          out.textContent='Welcome! You are signed up.';
          rewardEl.textContent = '';
        }
        showWallet(stamps);

        // register for pushes
        if ('Notification' in window) {
          window._ensureFCMRegistered && window._ensureFCMRegistered();
        }
      }catch(e){
        out.textContent='Error: '+e.message;
      }
    });
  </script>
</body>
</html>
