let TOKEN = localStorage.getItem('samadAdminToken') || '';
let editingId = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function money(n) {
  return `GH₵${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
}

async function api(url, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    Authorization: `Bearer ${TOKEN}`
  };
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

async function login(e) {
  e.preventDefault();
  const msg = $('#loginMsg');
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('#adminEmail').value,
        password: $('#adminPassword').value
      })
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Login failed');
    TOKEN = d.token;
    localStorage.setItem('samadAdminToken', TOKEN);
    showApp();
    await loadAll();
  } catch (err) {
    msg.textContent = err.message;
  }
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

async function logout() {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {}
  localStorage.removeItem('samadAdminToken');
  TOKEN = '';
  location.reload();
}

$$('nav button').forEach(b => b.addEventListener('click', () => {
  $$('nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#' + b.dataset.page).classList.add('active');
  $('#pageTitle').textContent = b.textContent;
}));

async function loadAll() {
  try {
    const [s, p, o] = await Promise.all([
      api('/api/admin/summary'),
      api('/api/admin/products'),
      api('/api/admin/orders')
    ]);

    $('#sProducts').textContent = s.activeProducts;
    $('#sOrders').textContent = s.orders;
    $('#sCustomers').textContent = s.customers;
    $('#sRevenue').textContent = money(s.revenue);
    $('#sLowStock').textContent = s.lowStock;
    $('#sPending').textContent = s.pending;
    renderProducts(p.products);
    renderOrders(o.orders);

    const statuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    $('#statusList').innerHTML = statuses.map(x => `
      <div class="status-row"><span>${x}</span><b>${o.orders.filter(y => y.status === x).length}</b></div>
    `).join('');
  } catch (e) {
    if (/expired|authentication/i.test(e.message)) logout();
    else alert(e.message);
  }
}

function renderProducts(ps) {
  $('#productTable').innerHTML = ps.map(p => `
    <tr>
      <td>
        <div class="prod-cell">
          <img src="${p.image}" onerror="this.src='/assets/samad-logo.png'">
          <span><b>${p.name}</b><small>${p.sku || ''}</small></span>
        </div>
      </td>
      <td>${p.category}</td>
      <td>${money(p.price)}</td>
      <td><span class="stock ${p.stock <= 5 ? 'low' : ''}">${p.stock}</span></td>
      <td>
        <button class="toggle ${p.active !== false ? 'on' : ''}" onclick="toggleProduct('${p.id}',${p.active !== false})">
          ${p.active !== false ? 'Published' : 'Hidden'}
        </button>
      </td>
      <td>
        <button class="action" onclick="editProduct('${p.id}')">Edit</button>
        <button class="action danger" onclick="deleteProduct('${p.id}')">Archive</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">No products.</td></tr>';
}

function renderOrders(os) {
  $('#orderTable').innerHTML = os.map(o => `
    <tr>
      <td><b>${o.id}</b><br><small>${new Date(o.createdAt).toLocaleString()}</small></td>
      <td>${o.customer.name}<br>${o.customer.phone}<br><small>${o.customer.address}</small></td>
      <td>${money(o.total)}</td>
      <td>${o.paymentMethod}<br><small>${o.paymentStatus || 'Pending'}</small></td>
      <td><span class="status">${o.status}</span></td>
      <td>
        <select onchange="updateOrder('${o.id}',this.value)">
          ${['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled']
            .map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">No orders.</td></tr>';
}

async function toggleProduct(id, current) {
  try {
    await api('/api/admin/products/' + id + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !current })
    });
    loadAll();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteProduct(id) {
  if (!confirm('Archive this product? It will disappear from the storefront but remain in the admin catalog.')) return;
  try {
    await api('/api/admin/products/' + id, { method: 'DELETE' });
    loadAll();
  } catch (e) {
    alert(e.message);
  }
}

async function updateOrder(id, status) {
  try {
    await api('/api/admin/orders/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadAll();
  } catch (e) {
    alert(e.message);
  }
}

async function editProduct(id) {
  try {
    const d = await api('/api/admin/products');
    const p = d.products.find(x => x.id === id);
    if (!p) return;
    editingId = id;
    fillForm(p);
    $('#productModalTitle').textContent = 'Edit product';
    $('#productModal').classList.add('show');
  } catch (e) {
    alert(e.message);
  }
}

function fillForm(p) {
  const f = $('#productForm');
  Object.keys(p).forEach(k => {
    const el = f.elements[k];
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(p[k]);
    else el.value = p[k] ?? '';
  });
  f.elements.id.value = p.id;
}

function showProductForm() {
  editingId = null;
  $('#productForm').reset();
  $('#productForm').elements.id.value = '';
  $('#productModalTitle').textContent = 'Add product';
  $('#formMsg').textContent = '';
  $('#productModal').classList.add('show');
}

function closeProductForm() {
  $('#productModal').classList.remove('show');
}

async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

$('#productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  const msg = $('#formMsg');
  msg.textContent = 'Saving...';
  try {
    let image = (f.elements.image.value || '').trim();
    const file = $('#imageFile').files[0];

    if (file) {
      msg.textContent = 'Uploading image...';
      const data = await fileToDataURL(file);
      const up = await api('/api/admin/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, filename: file.name })
      });
      image = up.url;
    }

    const body = Object.fromEntries(new FormData(f));
    body.image = image;
    body.featured = f.elements.featured.checked;
    body.isNew = f.elements.isNew.checked;
    body.flashSale = f.elements.flashSale.checked;
    body.sampleListing = f.elements.sampleListing.checked;
    delete body.id;

    const url = editingId ? '/api/admin/products/' + editingId : '/api/admin/products';
    await api(url, {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    closeProductForm();
    f.reset();
    loadAll();
  } catch (err) {
    msg.textContent = err.message;
  }
});

$('#loginForm').addEventListener('submit', login);
$('#logoutBtn').addEventListener('click', logout);

if (TOKEN) {
  api('/api/admin/summary')
    .then(() => {
      showApp();
      loadAll();
    })
    .catch(() => {
      localStorage.removeItem('samadAdminToken');
      TOKEN = '';
    });
}
