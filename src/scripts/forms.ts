/** Progressive-enhancement form submit to a static-friendly backend (Web3Forms / Formspree). */
export function initForms() {
  document.querySelectorAll<HTMLFormElement>('[data-form]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const status = form.querySelector<HTMLElement>('[data-status]')!;
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const label = form.querySelector<HTMLElement>('[data-submit-label]')!;
      const setStatus = (msg: string, state = '') => { status.textContent = msg; status.dataset.state = state; };

      if (!form.checkValidity()) {
        const bad = form.querySelector<HTMLInputElement>(':invalid:not([type=hidden])');
        bad?.focus();
        setStatus(bad?.type === 'email' && bad.value ? 'Please enter a valid email address.' : 'Please fill in all required fields.', 'error');
        return;
      }
      const data = Object.fromEntries(new FormData(form));
      if (data.botcheck) return; // honeypot tripped
      if ('access_key' in data && !data.access_key) {
        setStatus('The form isn’t connected yet. Set PUBLIC_WEB3FORMS_KEY (see README).', 'error');
        return;
      }

      btn.disabled = true;
      label.textContent = 'Sending…';
      setStatus('');
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) throw new Error(json.message || `Request failed (${res.status})`);
        form.reset();
        form.classList.add('is-sent');
        form.querySelector<HTMLElement>('.form__success')?.focus();
      } catch (err) {
        setStatus('Something went wrong sending your message. Please try again in a moment.', 'error');
        console.error(err);
      } finally {
        btn.disabled = false;
        label.textContent = 'Submit Now';
      }
    };
  });
}
