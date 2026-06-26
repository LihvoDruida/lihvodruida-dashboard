export default function AppFooter() {
  return (
    <footer className="app-footer app-footer--site-wide" aria-label="Юридична інформація Mistblossom Vanguard">
      <div className="app-footer__inner">
        <div className="app-footer__brand" aria-label="Mistblossom Vanguard">
          <span className="app-footer__crest" aria-hidden="true">
            <svg viewBox="0 0 64 64" role="img" focusable="false">
              <path
                className="app-footer__crest-shadow"
                d="M32 5.5 49.5 12v18.9c0 13.2-7.1 22.6-17.5 27.6C21.6 53.5 14.5 44.1 14.5 30.9V12L32 5.5Z"
              />
              <path
                className="app-footer__crest-border"
                d="M32 5.5 49.5 12v18.9c0 13.2-7.1 22.6-17.5 27.6C21.6 53.5 14.5 44.1 14.5 30.9V12L32 5.5Z"
              />
              <path
                className="app-footer__crest-inner"
                d="M32 11.5 44.5 16v14.6c0 9.5-4.9 16.7-12.5 20.8-7.6-4.1-12.5-11.3-12.5-20.8V16L32 11.5Z"
              />
            </svg>
            <span className="app-footer__crest-letter">M</span>
          </span>
          <strong className="app-footer__title">Mistblossom Vanguard</strong>
          <span className="app-footer__separator" aria-hidden="true" />
          <span className="app-footer__tagline">Панель профілів, рейдів, правил і Discord-ролей.</span>
        </div>
        <nav className="app-footer__links" aria-label="Юридичні сторінки">
          <a href="/terms">Умови</a>
          <span className="app-footer__link-separator" aria-hidden="true" />
          <a href="/privacy">Приватність</a>
        </nav>
      </div>
    </footer>
  );
}
