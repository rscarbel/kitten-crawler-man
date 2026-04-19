import type { AuthClient, AuthUser } from './AuthClient';

type Mode = 'login' | 'register';

const STYLES = `
  #auth-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    font-family: 'Courier New', Courier, monospace;
  }
  #auth-card {
    background: #0d0d1a;
    border: 2px solid #7c3aed;
    border-radius: 4px;
    padding: 40px 48px;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 0 40px rgba(124, 58, 237, 0.25);
  }
  #auth-title {
    color: #e2e8f0;
    font-size: 20px;
    letter-spacing: 4px;
    margin: 0 0 28px;
    text-align: center;
    text-transform: uppercase;
  }
  #auth-error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid #ef4444;
    border-radius: 3px;
    color: #fca5a5;
    font-size: 13px;
    margin-bottom: 16px;
    padding: 10px 12px;
    text-align: center;
  }
  .auth-input {
    background: #0a0a14;
    border: 1px solid #3730a3;
    border-radius: 3px;
    color: #e2e8f0;
    display: block;
    font-family: inherit;
    font-size: 14px;
    margin-bottom: 12px;
    outline: none;
    padding: 10px 12px;
    transition: border-color 0.15s;
    width: 100%;
    box-sizing: border-box;
  }
  .auth-input:focus { border-color: #7c3aed; }
  .auth-input::placeholder { color: #4b5563; }
  #auth-submit {
    background: #5b21b6;
    border: none;
    border-radius: 3px;
    color: #e2e8f0;
    cursor: pointer;
    display: block;
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 2px;
    margin-top: 4px;
    padding: 12px;
    text-transform: uppercase;
    transition: background 0.15s;
    width: 100%;
  }
  #auth-submit:hover { background: #6d28d9; }
  #auth-submit:active { background: #4c1d95; }
  #auth-toggle {
    background: none;
    border: none;
    color: #6d28d9;
    cursor: pointer;
    display: block;
    font-family: inherit;
    font-size: 12px;
    margin-top: 20px;
    padding: 0;
    text-align: center;
    text-decoration: underline;
    width: 100%;
  }
  #auth-toggle:hover { color: #7c3aed; }
  #auth-divider {
    border: none;
    border-top: 1px solid #1e1b4b;
    margin: 0 0 20px;
  }
`;

export class LoginUI {
  private readonly overlay: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  constructor(private readonly client: AuthClient) {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STYLES;
    document.head.appendChild(this.styleEl);

    this.overlay = document.createElement('div');
    document.body.appendChild(this.overlay);
  }

  show(): Promise<AuthUser> {
    return new Promise((resolve) => this.render('login', '', resolve));
  }

  private render(mode: Mode, errorMsg: string, resolve: (u: AuthUser) => void): void {
    const isLogin = mode === 'login';

    this.overlay.innerHTML = `
      <div id="auth-overlay">
        <div id="auth-card">
          <p id="auth-title">${isLogin ? 'Enter the Dungeon' : 'Create Account'}</p>
          <hr id="auth-divider" />
          ${errorMsg ? `<div id="auth-error">${this.escape(errorMsg)}</div>` : ''}
          <form id="auth-form" novalidate>
            <input
              id="auth-username"
              class="auth-input"
              type="text"
              placeholder="Username"
              autocomplete="username"
              spellcheck="false"
              maxlength="32"
            />
            <input
              id="auth-password"
              class="auth-input"
              type="password"
              placeholder="Password"
              autocomplete="${isLogin ? 'current-password' : 'new-password'}"
            />
            <button id="auth-submit" type="submit">
              ${isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <button id="auth-toggle" type="button">
            ${isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    `;

    const form = document.getElementById('auth-form') as HTMLFormElement;
    const usernameInput = document.getElementById('auth-username') as HTMLInputElement;
    const passwordInput = document.getElementById('auth-password') as HTMLInputElement;
    const toggleBtn = document.getElementById('auth-toggle') as HTMLButtonElement;
    const submitBtn = document.getElementById('auth-submit') as HTMLButtonElement;

    // Auto-focus username field
    requestAnimationFrame(() => usernameInput.focus());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (!username || !password) {
        this.render(mode, 'Please enter a username and password', resolve);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        const user = isLogin
          ? await this.client.login(username, password)
          : await this.client.register(username, password);
        this.destroy();
        resolve(user);
      } catch (err: unknown) {
        this.render(mode, (err as Error).message, resolve);
      }
    });

    toggleBtn.addEventListener('click', () => {
      this.render(isLogin ? 'register' : 'login', '', resolve);
    });
  }

  private destroy(): void {
    this.overlay.remove();
    this.styleEl.remove();
  }

  private escape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
