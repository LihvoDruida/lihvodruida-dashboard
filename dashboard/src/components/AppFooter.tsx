export default function AppFooter() {
  return (
    <footer className="app-footer" aria-label="Юридична інформація Mistblossom Vanguard">
      <div className="app-footer__inner">
        <div className="app-footer__brand">
          <strong>Mistblossom Vanguard</strong>
          <span>Панель профілів, рейдів, правил і Discord-ролей.</span>
        </div>
        <nav className="app-footer__links" aria-label="Юридичні сторінки">
          <a href="/terms">Умови</a>
          <a href="/privacy">Приватність</a>
        </nav>
      </div>
    </footer>
  );
}
