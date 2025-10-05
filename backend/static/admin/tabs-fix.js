(function(){
  function log(){ if (window && window.console) try{ console.debug.apply(console, arguments); }catch(e){} }
  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  function bySelAll(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function showSection(name, form){
    var map = {
      general: bySelAll('fieldset.tab.general', form),
      permissions: bySelAll('fieldset.tab.permissions', form)
    };
    ['general','permissions'].forEach(function(k){ (map[k]||[]).forEach(function(fs){ fs.style.display = (k===name) ? '' : 'none'; }); });
  }
  function activeTabName(){
    var act = document.querySelector('.nav-tabs .nav-link.active');
    var txt = act ? (act.textContent||'').toLowerCase() : '';
    if (/permission|صلاحيات/.test(txt)) return 'permissions';
    return 'general';
  }
  ready(function(){
    var form = document.querySelector('form');
    if(!form) return log('[tabs-fix] no form found');
    // initial state
    var name = activeTabName();
    log('[tabs-fix] initial tab:', name);
    showSection(name, form);
    // clicks
    bySelAll('.nav-tabs .nav-link').forEach(function(a){
      a.addEventListener('click', function(){ setTimeout(function(){
        var n = activeTabName();
        log('[tabs-fix] tab changed:', n);
        showSection(n, form);
      }, 0); });
    });
  });
})();
