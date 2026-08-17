/**
 * The Flying Dutchmen - Shared Universal Navigation Bar
 * Works seamlessly in both React applications and Vanilla JS pages.
 * Ensures identical brand title, navigation menu, SSO auth status, language modal,
 * and mobile portrait responsive design across Home, Lobby, Forum, Stats & Apps.
 */

(function(window) {
  'use strict';

  // Navigation Links Definition
  const NAV_ITEMS = [
    { id: 'home', label: 'Home', icon: 'bi-house-door', href: 'https://theflyingdutchmen.games/' },
    { id: 'lobby', label: 'Lobby', drawerLabel: 'Lobby & Games', icon: 'bi-grid-fill', href: 'https://lobby.theflyingdutchmen.games/' },
    { id: 'forum', label: 'Forum', icon: 'bi-chat-dots', href: 'https://forum.theflyingdutchmen.games/auth/tfd' },
    { id: 'stats', label: 'Stats', drawerLabel: 'Stats & Rankings', icon: 'bi-graph-up', href: 'https://stats.theflyingdutchmen.games/' }
  ];

  const LANGUAGES = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' }
  ];

  // Helper to detect current language
  function getCurrentLanguage() {
    if (window.flyOnI18n && typeof window.flyOnI18n.getLanguage === 'function') {
      return window.flyOnI18n.getLanguage();
    }
    return localStorage.getItem('site-language') || localStorage.getItem('fly-on-language') || 'en';
  }

  function getLangInfo(lang) {
    const found = LANGUAGES.find(l => l.code === lang);
    return found || LANGUAGES[0];
  }

  // Detect active section based on current hostname / pathname
  function detectActiveSection() {
    const host = window.location.hostname.toLowerCase();
    if (host.startsWith('lobby')) return 'lobby';
    if (host.startsWith('forum')) return 'forum';
    if (host.startsWith('stats')) return 'stats';
    return 'home';
  }

  /**
   * Vanilla JS Header Renderer & Manager
   */
  class TFDNavbarVanilla {
    constructor(options = {}) {
      this.options = Object.assign({
        container: '#tfd-navbar',
        active: detectActiveSection(),
        onAuthChange: null,
        onLanguageChange: null
      }, options);

      this.currentUser = null;
      this.mobileMenuOpen = false;
      this.currentLanguage = getCurrentLanguage();

      this.init();
    }

    async init() {
      this.resolveContainer();
      if (!this.containerEl) return;

      this.render();
      this.attachEventListeners();
      await this.checkAuth();
    }

    resolveContainer() {
      if (typeof this.options.container === 'string') {
        this.containerEl = document.querySelector(this.options.container);
      } else {
        this.containerEl = this.options.container;
      }

      if (!this.containerEl) {
        this.containerEl = document.querySelector('.tfd-navbar') || document.getElementById('tfd-navbar');
      }
    }

    async checkAuth() {
      try {
        const res = await fetch('https://theflyingdutchmen.games/api/user', {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.user) {
            this.currentUser = data.user;
            this.notifyAuthChange(data.user);
            this.updateAuthView();
            return;
          }
        }
      } catch (err) {
        // Guest session
      }
      this.currentUser = null;
      this.notifyAuthChange(null);
      this.updateAuthView();
    }

    notifyAuthChange(user) {
      if (typeof this.options.onAuthChange === 'function') {
        this.options.onAuthChange(user);
      }
      window.dispatchEvent(new CustomEvent('tfd-auth-change', { detail: { user } }));
    }

    toggleMobileMenu(forceState) {
      this.mobileMenuOpen = forceState !== undefined ? forceState : !this.mobileMenuOpen;
      const drawer = document.getElementById('tfdMobileDrawer');
      const toggle = document.getElementById('tfdMobileToggle');

      if (drawer) {
        if (this.mobileMenuOpen) {
          drawer.classList.add('open');
          document.body.style.overflow = 'hidden';
        } else {
          drawer.classList.remove('open');
          document.body.style.overflow = '';
        }
      }

      if (toggle) {
        toggle.innerHTML = `<i class="bi ${this.mobileMenuOpen ? 'bi-x-lg' : 'bi-list'}"></i>`;
      }
    }

    openLanguageModal() {
      this.toggleMobileMenu(false);
      this.renderLanguageModal();
    }

    async selectLanguage(langCode) {
      this.currentLanguage = langCode;
      localStorage.setItem('site-language', langCode);

      if (window.flyOnI18n && typeof window.flyOnI18n.changeLanguage === 'function') {
        await window.flyOnI18n.changeLanguage(langCode);
      }

      this.closeLanguageModal();
      this.render();
      this.attachEventListeners();
      this.updateAuthView();

      if (typeof this.options.onLanguageChange === 'function') {
        this.options.onLanguageChange(langCode);
      }
      window.dispatchEvent(new CustomEvent('tfd-language-change', { detail: { language: langCode } }));
    }

    renderLanguageModal() {
      let modal = document.getElementById('tfdLangModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'tfdLangModal';
        document.body.appendChild(modal);
      }

      modal.innerHTML = `
        <div class="modal d-block" style="background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;">
          <div class="modal-dialog modal-dialog-centered" style="max-width: 440px; width: 90%; margin: 0;">
            <div class="modal-content" style="background: linear-gradient(180deg, #101c10 0%, #162616 100%); border: 2px solid rgba(212, 175, 55, 0.4); border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.7); overflow: hidden; color: #f8fafc;">
              <div class="modal-header" style="border-bottom: 1px solid rgba(212, 175, 55, 0.25); padding: 1.25rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                <h5 class="modal-title" style="margin: 0; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; color: #f7df8b; font-size: 1.1rem;">
                  <i class="bi bi-translate"></i> Select Language
                </h5>
                <button type="button" class="btn-close-modal" id="tfdCloseLangModal" style="background: transparent; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0.25rem;">
                  <i class="bi bi-x-lg"></i>
                </button>
              </div>
              <div class="modal-body" style="padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
                ${LANGUAGES.map(lang => `
                  <button type="button" class="tfd-lang-option ${lang.code === this.currentLanguage ? 'active' : ''}" data-lang="${lang.code}" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0.85rem 1.15rem; background: ${lang.code === this.currentLanguage ? 'rgba(74, 124, 44, 0.3)' : 'rgba(255, 255, 255, 0.04)'}; border: 1px solid ${lang.code === this.currentLanguage ? 'rgba(212, 175, 55, 0.5)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 10px; color: #fff; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
                    <span style="display: flex; align-items: center; gap: 0.75rem; font-size: 1rem;">
                      <span style="font-size: 1.3rem;">${lang.flag}</span>
                      <span>${lang.name}</span>
                    </span>
                    ${lang.code === this.currentLanguage ? '<i class="bi bi-check-circle-fill text-gold" style="color: #d4af37; font-size: 1.1rem;"></i>' : ''}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `;

      modal.querySelector('#tfdCloseLangModal').onclick = () => this.closeLanguageModal();
      modal.onclick = (e) => {
        if (e.target === modal.firstElementChild) this.closeLanguageModal();
      };
      modal.querySelectorAll('.tfd-lang-option').forEach(btn => {
        btn.onclick = () => this.selectLanguage(btn.dataset.lang);
      });
    }

    closeLanguageModal() {
      const modal = document.getElementById('tfdLangModal');
      if (modal) modal.innerHTML = '';
    }

    render() {
      const active = this.options.active || detectActiveSection();
      const langInfo = getLangInfo(this.currentLanguage);
      const returnUrl = encodeURIComponent(window.location.href);

      const navLinksHtml = NAV_ITEMS.map(item => `
        <li>
          <a href="${item.href}" class="tfd-nav-link ${active === item.id ? 'active' : ''}">
            <i class="bi ${item.icon}"></i> ${item.label}
          </a>
        </li>
      `).join('');

      const drawerLinksHtml = NAV_ITEMS.map(item => `
        <a href="${item.href}" class="tfd-mobile-link ${active === item.id ? 'active' : ''}">
          <i class="bi ${item.icon} fs-5 text-warning"></i>
          <span>${item.drawerLabel || item.label}</span>
        </a>
      `).join('');

      this.containerEl.innerHTML = `
        <div class="tfd-navbar-inner">
          <!-- Row 1 (Mobile Portrait): Centered Brand Title -->
          <div class="tfd-brand-row">
            <a href="https://theflyingdutchmen.games/" class="tfd-brand">
              <span class="tfd-brand-text">The Flying Dutchmen</span>
            </a>
          </div>

          <!-- Desktop Navigation Links (Centered) -->
          <nav>
            <ul class="tfd-nav-links">
              ${navLinksHtml}
            </ul>
          </nav>

          <!-- Row 2 (Mobile Portrait) / Right Side (Desktop): Language, SSO Login & Mobile Toggle -->
          <div class="tfd-actions-row">
            <div class="tfd-actions-left">
              <button class="tfd-icon-btn" id="tfdLangBtn" title="Select Language" aria-label="Select Language">
                <span>${langInfo.flag}</span>
                <span style="font-size: 0.8rem">${langInfo.code.toUpperCase()}</span>
              </button>
            </div>

            <div class="tfd-actions-right">
              <div id="tfdAuthContainer" class="tfd-actions-right">
                <a href="https://theflyingdutchmen.games/login?returnTo=${returnUrl}" class="tfd-btn-login">
                  <i class="bi bi-box-arrow-in-right"></i>
                  <span>Login</span>
                </a>
              </div>

              <!-- Mobile Hamburger Toggle -->
              <button class="tfd-mobile-toggle" id="tfdMobileToggle" aria-label="Toggle navigation">
                <i class="bi bi-list"></i>
              </button>
            </div>
          </div>
        </div>
      `;

      // Render or update Mobile Drawer
      let drawer = document.getElementById('tfdMobileDrawer');
      if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'tfdMobileDrawer';
        drawer.className = 'tfd-mobile-drawer';
        this.containerEl.after(drawer);
      }

      drawer.innerHTML = `
        ${drawerLinksHtml}
        <hr style="border-color: rgba(212, 175, 55, 0.2); margin: 0.5rem 0;" />
        <button class="tfd-mobile-link w-100 text-start border-0" id="tfdDrawerLangBtn" style="background: transparent;">
          <i class="bi bi-translate fs-5 text-warning"></i>
          <span>Language (${langInfo.flag} ${langInfo.code.toUpperCase()})</span>
        </button>
        <div id="tfdDrawerAuthContainer">
          <a href="https://theflyingdutchmen.games/login?returnTo=${returnUrl}" class="tfd-btn-login w-100 justify-content-center py-2 mt-2">
            <i class="bi bi-box-arrow-in-right"></i>
            <span>Login</span>
          </a>
        </div>
      `;
    }

    updateAuthView() {
      const authContainer = document.getElementById('tfdAuthContainer');
      const drawerAuthContainer = document.getElementById('tfdDrawerAuthContainer');
      const returnUrl = encodeURIComponent(window.location.href);

      if (this.currentUser) {
        const userHtml = `
          <div class="tfd-user-pill">
            <i class="bi bi-person-fill" style="color: #d4af37"></i>
            <span style="font-weight: 600; max-width: 105px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${this.currentUser.username}
            </span>
            <span class="tfd-user-role">${this.currentUser.role || 'USER'}</span>
            <a href="https://theflyingdutchmen.games/logout?redirect=${returnUrl}" class="tfd-user-logout" title="Logout" aria-label="Logout">
              <i class="bi bi-box-arrow-right"></i>
            </a>
          </div>
        `;

        const drawerUserHtml = `
          <a href="https://theflyingdutchmen.games/logout?redirect=${returnUrl}" class="btn btn-outline-danger w-100 py-2 d-flex align-items-center justify-content-center gap-2 mt-2" style="text-decoration: none; border-radius: 8px;">
            <i class="bi bi-box-arrow-right"></i>
            <span>Logout (${this.currentUser.username})</span>
          </a>
        `;

        if (authContainer) authContainer.innerHTML = userHtml;
        if (drawerAuthContainer) drawerAuthContainer.innerHTML = drawerUserHtml;
      } else {
        const guestHtml = `
          <a href="https://theflyingdutchmen.games/login?returnTo=${returnUrl}" class="tfd-btn-login">
            <i class="bi bi-box-arrow-in-right"></i>
            <span>Login</span>
          </a>
        `;
        const drawerGuestHtml = `
          <a href="https://theflyingdutchmen.games/login?returnTo=${returnUrl}" class="tfd-btn-login w-100 justify-content-center py-2 mt-2">
            <i class="bi bi-box-arrow-in-right"></i>
            <span>Login</span>
          </a>
        `;

        if (authContainer) authContainer.innerHTML = guestHtml;
        if (drawerAuthContainer) drawerAuthContainer.innerHTML = drawerGuestHtml;
      }
    }

    attachEventListeners() {
      const toggle = document.getElementById('tfdMobileToggle');
      if (toggle) {
        toggle.onclick = () => this.toggleMobileMenu();
      }

      const langBtn = document.getElementById('tfdLangBtn');
      if (langBtn) {
        langBtn.onclick = () => this.openLanguageModal();
      }

      const drawerLangBtn = document.getElementById('tfdDrawerLangBtn');
      if (drawerLangBtn) {
        drawerLangBtn.onclick = () => this.openLanguageModal();
      }

      // Close mobile menu on link click
      const drawer = document.getElementById('tfdMobileDrawer');
      if (drawer) {
        drawer.querySelectorAll('a').forEach(link => {
          link.addEventListener('click', () => this.toggleMobileMenu(false));
        });
      }
    }
  }

  // React Component (if React is in environment)
  if (typeof React !== 'undefined') {
    const { createElement: h, useState, useEffect } = React;

    window.Navbar = window.TFDNavbar = function(props) {
      const active = props.active || detectActiveSection();
      const currentUser = props.currentUser || null;
      const onLogout = props.onLogout || props.handleLogout;
      const onOpenLanguageModal = props.onOpenLanguageModal || (() => {
        if (props.setLanguageModalOpen) props.setLanguageModalOpen(true);
      });
      const t = props.t || ((key, def) => def || key);

      const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
      const currentLang = getCurrentLanguage();
      const langInfo = props.langInfo || getLangInfo(currentLang);
      const returnUrl = encodeURIComponent(window.location.href);

      useEffect(() => {
        if (mobileMenuOpen) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = '';
        }
        return () => {
          document.body.style.overflow = '';
        };
      }, [mobileMenuOpen]);

      return h(
        React.Fragment,
        null,
        h(
          'header',
          { className: 'tfd-navbar' },
          h(
            'div',
            { className: 'tfd-navbar-inner' },
            // Brand row (Mobile Portrait Row 1)
            h(
              'div',
              { className: 'tfd-brand-row' },
              h(
                'a',
                { href: 'https://theflyingdutchmen.games/', className: 'tfd-brand' },
                h('span', { className: 'tfd-brand-text' }, 'The Flying Dutchmen')
              )
            ),
            // Desktop nav links (Center)
            h(
              'nav',
              null,
              h(
                'ul',
                { className: 'tfd-nav-links' },
                NAV_ITEMS.map(item =>
                  h(
                    'li',
                    { key: item.id },
                    h(
                      'a',
                      {
                        href: item.href,
                        className: `tfd-nav-link ${active === item.id ? 'active' : ''}`
                      },
                      h('i', { className: `bi ${item.icon}` }),
                      ' ',
                      t(`nav.${item.id}`, item.label)
                    )
                  )
                )
              )
            ),
            // Actions row (Mobile Portrait Row 2 / Desktop Right)
            h(
              'div',
              { className: 'tfd-actions-row' },
              h(
                'div',
                { className: 'tfd-actions-left' },
                h(
                  'button',
                  {
                    className: 'tfd-icon-btn',
                    onClick: onOpenLanguageModal,
                    title: t('common.language', 'Language'),
                    'aria-label': 'Select Language'
                  },
                  h('span', null, langInfo.flag),
                  h('span', { style: { fontSize: '0.8rem' } }, langInfo.code)
                )
              ),
              h(
                'div',
                { className: 'tfd-actions-right' },
                currentUser
                  ? h(
                      'div',
                      { className: 'tfd-user-pill' },
                      h('i', { className: 'bi bi-person-fill', style: { color: '#d4af37' } }),
                      h(
                        'span',
                        {
                          style: {
                            fontWeight: 600,
                            maxWidth: '105px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }
                        },
                        currentUser.username
                      ),
                      h('span', { className: 'tfd-user-role' }, currentUser.role || 'USER'),
                      h(
                        'button',
                        {
                          className: 'tfd-user-logout',
                          onClick: onLogout,
                          title: t('nav.logout', 'Logout'),
                          'aria-label': 'Logout'
                        },
                        h('i', { className: 'bi bi-box-arrow-right' })
                      )
                    )
                  : h(
                      'a',
                      {
                        href: `/login?returnTo=${returnUrl}`,
                        className: 'tfd-btn-login'
                      },
                      h('i', { className: 'bi bi-box-arrow-in-right' }),
                      h('span', null, t('nav.login', 'Login'))
                    ),
                h(
                  'button',
                  {
                    className: 'tfd-mobile-toggle',
                    onClick: () => setMobileMenuOpen(!mobileMenuOpen),
                    'aria-label': 'Toggle navigation'
                  },
                  h('i', { className: `bi ${mobileMenuOpen ? 'bi-x-lg' : 'bi-list'}` })
                )
              )
            )
          )
        ),
        // Mobile Drawer
        h(
          'div',
          { className: `tfd-mobile-drawer ${mobileMenuOpen ? 'open' : ''}` },
          NAV_ITEMS.map(item =>
            h(
              'a',
              {
                key: item.id,
                href: item.href,
                className: `tfd-mobile-link ${active === item.id ? 'active' : ''}`,
                onClick: () => setMobileMenuOpen(false)
              },
              h('i', { className: `bi ${item.icon} fs-5 text-warning` }),
              h('span', null, t(`nav.${item.id}`, item.drawerLabel || item.label))
            )
          ),
          h('hr', { style: { borderColor: 'rgba(212, 175, 55, 0.2)', margin: '0.5rem 0' } }),
          h(
            'button',
            {
              className: 'tfd-mobile-link w-100 text-start border-0',
              style: { background: 'transparent' },
              onClick: () => {
                setMobileMenuOpen(false);
                onOpenLanguageModal();
              }
            },
            h('i', { className: 'bi bi-translate fs-5 text-warning' }),
            h('span', null, `${t('common.language', 'Language')} (${langInfo.flag} ${langInfo.code})`)
          ),
          currentUser
            ? h(
                'button',
                {
                  className: 'btn btn-outline-danger w-100 py-2 d-flex align-items-center justify-content-center gap-2 mt-2',
                  onClick: () => {
                    setMobileMenuOpen(false);
                    if (onLogout) onLogout();
                  }
                },
                h('i', { className: 'bi bi-box-arrow-right' }),
                h('span', null, `${t('nav.logout', 'Logout')} (${currentUser.username})`)
              )
            : h(
                'a',
                {
                  href: `/login?returnTo=${returnUrl}`,
                  className: 'tfd-btn-login w-100 justify-content-center py-2 mt-2',
                  onClick: () => setMobileMenuOpen(false)
                },
                h('i', { className: 'bi bi-box-arrow-in-right' }),
                h('span', null, t('nav.login', 'Login'))
              )
        )
      );
    };
  }

  // Global mounting helper
  window.initTFDNavbar = function(options) {
    return new TFDNavbarVanilla(options);
  };

  // Auto-init on DOMContentLoaded if a navbar container exists
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('.tfd-navbar') || document.getElementById('tfd-navbar')) {
        window.tfdNavbarInstance = window.initTFDNavbar();
      }
    });
  } else {
    if (document.querySelector('.tfd-navbar') || document.getElementById('tfd-navbar')) {
      window.tfdNavbarInstance = window.initTFDNavbar();
    }
  }

})(window);
