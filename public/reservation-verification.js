/* Keep reservation verification fresh while guests enter details and select IDs. */
(() => {
  window.SakanReservationVerification = {
    create(container) {
      const status=document.createElement('p');status.className='application-note';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const retry=document.createElement('button');retry.type='button';retry.textContent='Retry security check';retry.hidden=true;
      container.after(status,retry);
      let widget,token='',starting,waiter,finished=false;
      function fail(message) {token='';status.textContent=message;retry.hidden=false;if(waiter){waiter.reject(Error(message));waiter=null;}}
      function loadApi(force=false) {
        if(window.turnstile)return Promise.resolve();
        return new Promise((resolve,reject)=>{
          let script=document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
          if(force&&script){script.remove();script=null;}
          const added=!script;if(!script){script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;}
          const timer=setTimeout(()=>done(Error('The security check could not load. Retry below; your form and selected IDs are kept.')),15000);
          const loaded=()=>done(window.turnstile?null:Error('The security check could not start. Retry below.'));
          const failed=()=>done(Error('The security check could not load. Retry below; your form and selected IDs are kept.'));
          function done(error){clearTimeout(timer);script.removeEventListener('load',loaded);script.removeEventListener('error',failed);error?reject(error):resolve();}
          script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});
          if(added)document.head.append(script);
        });
      }
      async function start(force=false) {
        if(widget!==undefined)return;
        if(starting)return starting;
        retry.hidden=true;status.textContent='Loading security check…';
        starting=(async()=>{
          await loadApi(force);
          await new Promise(resolve=>window.turnstile.ready(resolve));
          widget=window.turnstile.render(container,{
            sitekey:container.dataset.sitekey,appearance:'always',size:'flexible','refresh-expired':'auto','refresh-timeout':'auto',
            callback:value=>{token=value;status.textContent='';retry.hidden=true;if(waiter){waiter.resolve(value);waiter=null;}},
            'expired-callback':()=>{token='';status.textContent='Refreshing security check…';},
            'error-callback':()=>{fail('The security check could not finish. Retry below; your details and IDs are kept.');},
            'timeout-callback':()=>{fail('The security check timed out. Retry below; your details and IDs are kept.');},
          });
          if(!token)status.textContent='Complete the security check above before submitting.';
        })();
        try{await starting;}catch(e){fail(e.message);throw e;}finally{starting=null;}
      }
      function reset() {
        if(finished)return;
        token='';retry.hidden=true;status.textContent='Refreshing security check…';
        if(widget!==undefined&&window.turnstile)window.turnstile.reset(widget);
      }
      retry.addEventListener('click',()=>{if(widget!==undefined)reset();else start(true).catch(()=>{});});
      start().catch(()=>{});
      return {
        async getToken() {
          await start();
          if(token&&!window.turnstile.isExpired(widget))return token;
          container.scrollIntoView({behavior:'smooth',block:'center'});
          status.textContent='Complete the security check above. Your application will continue automatically.';
          return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{waiter=null;fail('Please finish the security check above, then submit again. Your details and IDs are kept.');reject(Error(status.textContent));},60000);
            waiter={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
            reset();
          });
        },
        reset,
        complete(){finished=true;container.hidden=true;status.hidden=true;retry.hidden=true;},
      };
    },
  };
})();
