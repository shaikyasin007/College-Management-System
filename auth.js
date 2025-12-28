// Simple mock auth module for demo purposes.
// Replace with real API calls later.

const Auth = (() => {
  const DEMO_USERS = {
    student: [
      { username: 'student1', password: 'hit123', name: 'Student One' },
      { username: 'student2', password: 'hit123', name: 'Student Two' },
    ],
    faculty: [
      { username: 'faculty1', password: 'hit123', name: 'Faculty One' },
      { username: 'faculty2', password: 'hit123', name: 'Faculty Two' },
    ],
    admin: [
      { username: 'admin', password: 'hit123', name: 'Administrator' },
    ],
  };

  function findUser(role, username) {
    return (DEMO_USERS[role] || []).find(u => u.username.toLowerCase() === String(username).toLowerCase());
  }

  function login(role, username, password) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let finalRole = role;
        let user;
        let wrongPassword = false;

        if (role && role !== 'any') {
          user = findUser(role, username);
        } else {
          // Try to find user across all roles
          for (const r of Object.keys(DEMO_USERS)) {
            const candidate = findUser(r, username);
            if (candidate) {
              finalRole = r;
              user = candidate;
              break;
            }
          }
        }

        if (!user) {
          reject({ code: 'USER_NOT_FOUND', message: 'User not found' });
          return;
        }

        if (user.password !== password) {
          wrongPassword = true;
        }

        if (wrongPassword) {
          reject({ code: 'INVALID_PASSWORD', message: 'Incorrect password' });
          return;
        }

        const token = btoa(`${finalRole}:${username}:${Date.now()}`);
        sessionStorage.setItem('auth_token', token);
        sessionStorage.setItem('auth_role', finalRole);
        sessionStorage.setItem('auth_name', user.name);
        sessionStorage.setItem('auth_username', user.username);
        resolve({ token, role: finalRole, name: user.name, username: user.username });
      }, 600);
    });
  }

  function requireAuth(role) {
    const token = sessionStorage.getItem('auth_token');
    const r = sessionStorage.getItem('auth_role');
    if (!token || (role && r !== role)) {
      window.location.href = '../login.html';
    }
  }

  function logout() {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_role');
    sessionStorage.removeItem('auth_name');
    sessionStorage.removeItem('auth_username');
    window.location.href = './index.html';
  }

  return { login, requireAuth, logout };
})();

// Global Theme Manager: dark/light toggle with persistence
(function(){
  try{
    const KEY = 'ui_theme';
    const root = document.documentElement;
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const saved = localStorage.getItem(KEY);
    const initial = saved ? saved : (prefersLight ? 'light' : 'dark');
    function apply(theme){
      if(theme==='light'){ root.setAttribute('data-theme','light'); }
      else { root.removeAttribute('data-theme'); }
    }
    apply(initial);

    // Add floating toggle button
    const btn = document.createElement('button');
    btn.className = 'theme-toggle';
    function labelFor(theme){ return theme==='light' ? '☀ Light' : '🌙 Dark'; }
    btn.textContent = labelFor(initial);
    btn.addEventListener('click', ()=>{
      const cur = root.getAttribute('data-theme')==='light' ? 'light' : 'dark';
      const next = cur==='light' ? 'dark' : 'light';
      apply(next); localStorage.setItem(KEY, next); btn.textContent = labelFor(next);
    });
    // Insert after DOM ready
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', ()=> document.body.appendChild(btn));
    } else { document.body.appendChild(btn); }
  }catch(_e){ /* no-op */ }
})();
