(function () {
  const config = window.DILEK_AGACI_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase) {
    document.body.innerHTML = '<main style="padding:40px;color:white">Uygulama bağlantısı hazırlanamadı.</main>';
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const inviteCode = new URLSearchParams(window.location.search).get('invite');

  const state = { user: null, trees: [], activeTree: null, items: [], poller: null, authMode: 'signin' };
  const $ = (id) => document.getElementById(id);

  const elements = {
    authView: $('auth-view'), appView: $('app-view'), userArea: $('user-area'), userEmail: $('user-email'),
    authForm: $('auth-form'), authMessage: $('auth-message'), authTitle: $('auth-title'), authSubtitle: $('auth-subtitle'),
    authSubmit: $('auth-submit'), email: $('email'), password: $('password'), inviteNote: $('invite-note'),
    emptyState: $('empty-state'), dashboard: $('tree-dashboard'), createTreeForm: $('create-tree-form'),
    treeNameInput: $('tree-name'), createMessage: $('create-message'), treeTitle: $('tree-title'), treeItems: $('tree-items'),
    treeEmptyHint: $('tree-empty-hint'), itemForm: $('item-form'), itemType: $('item-type'), itemMessage: $('item-message'),
    itemFormMessage: $('item-form-message'), itemList: $('item-list'), inviteCard: $('invite-card'),
    createInviteButton: $('create-invite-button'), inviteResult: $('invite-result'), inviteUrl: $('invite-url'),
    copyInviteButton: $('copy-invite-button'), inviteMessage: $('invite-message'), toast: $('toast')
  };

  if (inviteCode) elements.inviteNote.classList.remove('hidden');

  function setMessage(element, message, error = false) {
    element.textContent = message || '';
    element.classList.toggle('error', error);
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('visible');
    window.setTimeout(() => elements.toast.classList.remove('visible'), 2800);
  }

  function setLoading(button, loading, loadingText) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = loading;
    button.textContent = loading ? loadingText : button.dataset.label;
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
    const signup = mode === 'signup';
    elements.authTitle.textContent = signup ? 'Aramıza katıl' : 'Ağacına dön';
    elements.authSubtitle.textContent = signup ? 'Bir hesap oluştur; davet edildiğin ağaca hemen katıl.' : 'Dileklerini görmek için hesabına giriş yap.';
    elements.authSubmit.textContent = signup ? 'Hesap aç' : 'Giriş yap';
    elements.authSubmit.dataset.label = elements.authSubmit.textContent;
    elements.password.autocomplete = signup ? 'new-password' : 'current-password';
    setMessage(elements.authMessage, '');
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setMessage(elements.authMessage, '');
    setLoading(elements.authSubmit, true, 'Bekle…');
    const email = elements.email.value.trim();
    const password = elements.password.value;

    const result = state.authMode === 'signup'
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
      : await client.auth.signInWithPassword({ email, password });

    setLoading(elements.authSubmit, false);
    if (result.error) {
      setMessage(elements.authMessage, friendlyError(result.error.message), true);
      return;
    }

    if (state.authMode === 'signup' && !result.data.session) {
      setMessage(elements.authMessage, 'Hesabını doğrulamak için e-postana gelen bağlantıya tıkla.');
      return;
    }

    toast(state.authMode === 'signup' ? 'Hesabın hazır 🎉' : 'Hoş geldin ✨');
  }

  function friendlyError(message) {
    const lower = String(message).toLowerCase();
    if (lower.includes('invalid login')) return 'E-posta veya şifre doğru görünmüyor.';
    if (lower.includes('already registered')) return 'Bu e-postayla zaten bir hesap var. Giriş yapmayı dene.';
    if (lower.includes('password')) return 'Şifre en az 6 karakter olmalı.';
    if (lower.includes('email')) return 'Geçerli bir e-posta adresi yazmalısın.';
    return 'Bir şey ters gitti. Biraz sonra tekrar deneyebilirsin.';
  }

  async function applySession(session) {
    state.user = session?.user || null;
    clearInterval(state.poller);
    if (!state.user) {
      elements.authView.classList.remove('hidden');
      elements.appView.classList.add('hidden');
      elements.userArea.classList.add('hidden');
      return;
    }

    elements.authView.classList.add('hidden');
    elements.appView.classList.remove('hidden');
    elements.userArea.classList.remove('hidden');
    elements.userEmail.textContent = state.user.email || 'Üye';

    if (inviteCode) await redeemInvite(inviteCode);
    await loadTrees();
    state.poller = window.setInterval(() => state.activeTree && loadItems(false), 7000);
  }

  async function redeemInvite(code) {
    const { error } = await client.rpc('redeem_tree_invite', { p_code: code });
    if (error) {
      toast(error.message.includes('fully used') ? 'Bu davet artık geçerli değil.' : 'Davet bağlantısı geçersiz veya süresi dolmuş.');
      return;
    }
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('invite');
    history.replaceState({}, '', cleanUrl);
    toast('Ağaca katıldın 🎄');
  }

  async function loadTrees() {
    const { data, error } = await client.from('trees').select('*').order('created_at', { ascending: true });
    if (error) { toast('Ağaçlar yüklenemedi.'); return; }
    state.trees = data || [];
    state.activeTree = state.trees[0] || null;
    renderAppState();
    if (state.activeTree) await loadItems();
  }

  function renderAppState() {
    const hasTree = Boolean(state.activeTree);
    elements.emptyState.classList.toggle('hidden', hasTree);
    elements.dashboard.classList.toggle('hidden', !hasTree);
    if (!hasTree) return;
    elements.treeTitle.textContent = state.activeTree.name;
    elements.inviteCard.classList.toggle('hidden', state.activeTree.owner_id !== state.user.id);
  }

  async function createTree(event) {
    event.preventDefault();
    setMessage(elements.createMessage, '');
    const button = event.submitter;
    setLoading(button, true, 'Oluşturuluyor…');
    const { data, error } = await client.from('trees').insert({
      name: elements.treeNameInput.value.trim(), owner_id: state.user.id
    }).select().single();
    setLoading(button, false);
    if (error) { setMessage(elements.createMessage, 'Ağaç oluşturulamadı: ' + friendlyError(error.message), true); return; }
    state.activeTree = data;
    state.trees = [data];
    renderAppState();
    await loadItems();
    toast('Ağacın hazır! 🎄');
  }

  async function loadItems(showError = true) {
    const { data, error } = await client.from('tree_items').select('*').eq('tree_id', state.activeTree.id).order('created_at', { ascending: false });
    if (error) { if (showError) toast('Ağaç süsleri yüklenemedi.'); return; }
    state.items = data || [];
    renderItems();
  }

  function renderItems() {
    elements.treeItems.innerHTML = '';
    elements.itemList.innerHTML = '';
    elements.treeEmptyHint.classList.toggle('hidden', state.items.length > 0);

    if (!state.items.length) {
      elements.itemList.innerHTML = '<p class="empty-list">Henüz hiçbir şey eklenmedi.</p>';
      return;
    }

    const icons = { ornament: '●', wish: '✦', gift: '🎁' };
    const labels = { ornament: 'Süs', wish: 'Dilek', gift: 'Hediye' };
    state.items.forEach((item) => {
      const marker = document.createElement('button');
      marker.className = `tree-item ${item.item_type}`;
      marker.type = 'button';
      marker.style.left = `${item.position_x ?? 50}%`;
      marker.style.top = `${item.position_y ?? 50}%`;
      marker.textContent = icons[item.item_type] || '✦';
      marker.title = item.message;
      marker.setAttribute('aria-label', `${labels[item.item_type]}: ${item.message}`);
      marker.addEventListener('click', () => toast(item.message));
      elements.treeItems.appendChild(marker);

      const card = document.createElement('article');
      card.className = 'item-card';
      card.innerHTML = `<div class="item-card-icon">${icons[item.item_type] || '✦'}</div><div><p></p><small>${labels[item.item_type] || 'Not'}</small></div>`;
      card.querySelector('p').textContent = item.message;
      elements.itemList.appendChild(card);
    });
  }

  function randomTreePosition() {
    const y = 27 + Math.random() * 53;
    const normalized = Math.abs(y - 53) / 53;
    const halfWidth = 7 + (1 - normalized) * 24;
    return { x: 50 + (Math.random() * 2 - 1) * halfWidth, y };
  }

  async function addItem(event) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true, 'Ekleniyor…');
    setMessage(elements.itemFormMessage, '');
    const pos = randomTreePosition();
    const { error } = await client.from('tree_items').insert({
      tree_id: state.activeTree.id,
      created_by: state.user.id,
      item_type: elements.itemType.value,
      message: elements.itemMessage.value.trim(),
      position_x: pos.x.toFixed(2),
      position_y: pos.y.toFixed(2)
    });
    setLoading(button, false);
    if (error) { setMessage(elements.itemFormMessage, 'Eklenemedi: ' + friendlyError(error.message), true); return; }
    elements.itemForm.reset();
    await loadItems();
    toast('Ağaca eklendi ✨');
  }

  async function createInvite() {
    setLoading(elements.createInviteButton, true, 'Hazırlanıyor…');
    setMessage(elements.inviteMessage, '');
    const { data: code, error } = await client.rpc('create_tree_invite', {
      p_tree_id: state.activeTree.id, p_max_uses: null, p_expires_at: null
    });
    setLoading(elements.createInviteButton, false);
    if (error) { setMessage(elements.inviteMessage, 'Davet linki oluşturulamadı.', true); return; }
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('invite', code);
    elements.inviteUrl.value = url.toString();
    elements.inviteResult.classList.remove('hidden');
    setMessage(elements.inviteMessage, 'Bu linkin kullanım sınırı yok. Yalnızca güvendiğin kişilerle paylaş.');
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(elements.inviteUrl.value);
      toast('Davet linki kopyalandı 🔗');
    } catch {
      elements.inviteUrl.select();
      document.execCommand('copy');
      toast('Davet linki kopyalandı 🔗');
    }
  }

  document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.mode)));
  elements.authForm.addEventListener('submit', handleAuthSubmit);
  elements.createTreeForm.addEventListener('submit', createTree);
  elements.itemForm.addEventListener('submit', addItem);
  elements.createInviteButton.addEventListener('click', createInvite);
  elements.copyInviteButton.addEventListener('click', copyInvite);
  $('refresh-button').addEventListener('click', () => loadItems());
  $('logout-button').addEventListener('click', () => client.auth.signOut());

  client.auth.onAuthStateChange((_event, session) => applySession(session));
  client.auth.getSession().then(({ data }) => applySession(data.session));
})();
