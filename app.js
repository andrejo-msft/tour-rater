// Tour Rater app logic.
// Mobile-first, offline-first, single-file SPA. No frameworks.
//
// Screen flow:
//   passphrase -> name -> property -> category(0..5) -> summary
//   settings is a modal-ish overlay reachable from the gear icon.
//
// Storage (localStorage keys):
//   tr.passphraseHash    - SHA-256 hex of passphrase
//   tr.authedSession     - "1" if passphrase entered this session (sessionStorage)
//   tr.rater             - "drew" | "sherry"
//   tr.pat               - GitHub PAT
//   tr.repo              - "owner/repo"
//   tr.properties        - JSON array of {address, slug} added by user
//   tr.draft.<slug>.<rater> - in-progress rating object
//   tr.queue             - JSON array of rating objects waiting to upload
//
// Rating object shape: see README.md and rating spec.

(function () {
  'use strict';

  // -------- constants & utilities --------

  var LS = window.localStorage;
  var SS = window.sessionStorage;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
        else if (k === 'dataset') { for (var d in attrs[k]) e.dataset[d] = attrs[k][d]; }
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Slugify an address: lowercase, ASCII alnum + hyphens, no dupes.
  function slugify(s) {
    var abbrevs = {
      'street': 'st', 'avenue': 'ave', 'drive': 'dr', 'boulevard': 'blvd',
      'lane': 'ln', 'road': 'rd', 'court': 'ct', 'place': 'pl',
      'circle': 'cir', 'terrace': 'ter', 'parkway': 'pkwy', 'way': 'way',
      'north': 'n', 'south': 's', 'east': 'e', 'west': 'w',
      'northeast': 'ne', 'northwest': 'nw', 'southeast': 'se', 'southwest': 'sw',
      'saint': 'st'
    };
    return String(s)
      .toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .split('-').map(function (w) { return abbrevs[w] || w; }).join('-');
  }

  // SHA-256 hex via SubtleCrypto.
  async function sha256Hex(s) {
    var buf = new TextEncoder().encode(s);
    var hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  // base64-encode a UTF-8 string (works for non-ASCII just in case).
  function b64encode(s) {
    var bytes = new TextEncoder().encode(s);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function nowIso() {
    // ISO with local timezone offset (so Drew's local Saint Paul time is preserved).
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
  }

  // -------- state --------

  var state = {
    screen: 'passphrase',     // passphrase | name | property | category | summary | settings
    categoryIndex: 0,
    rater: LS.getItem('tr.rater') || null,
    property: null,           // {address, slug}
    rating: null,             // current draft rating object
    settingsReturnTo: null,
    statusBadge: 'idle',
    defaultProperties: []
  };

  // -------- setup-URL handling (QR pairing) --------

  function processSetupHash() {
    var hash = location.hash || '';
    if (hash.indexOf('#setup=') !== 0) return false;
    var raw = hash.slice('#setup='.length);
    // Format: PAT&repo=owner/repo&ph=hash   (PAT is the unnamed first token)
    // We tolerate URL-encoded params too.
    var parts = raw.split('&');
    var pat = decodeURIComponent(parts[0] || '');
    var repo = '';
    var ph = '';
    parts.slice(1).forEach(function (p) {
      var eq = p.indexOf('=');
      if (eq < 0) return;
      var key = p.slice(0, eq);
      var val = decodeURIComponent(p.slice(eq + 1));
      if (key === 'repo') repo = val;
      else if (key === 'ph') ph = val;
    });
    if (pat) LS.setItem('tr.pat', pat);
    if (repo) LS.setItem('tr.repo', repo);
    if (ph) LS.setItem('tr.passphraseHash', ph);
    // STRIP immediately so PAT does not stay in URL/history.
    history.replaceState(null, '', location.pathname + location.search);
    flashAlert('Paired. Choose your name to continue.', 'ok');
    return true;
  }

  // -------- passphrase gate --------

  function isAuthedThisSession() { return SS.getItem('tr.authedSession') === '1'; }
  function markAuthed() { SS.setItem('tr.authedSession', '1'); }

  // -------- rating draft persistence --------

  function draftKey(slug, rater) { return 'tr.draft.' + slug + '.' + rater; }

  function loadOrCreateRating(prop, rater) {
    var key = draftKey(prop.slug, rater);
    var existing = LS.getItem(key);
    if (existing) {
      try {
        var r = JSON.parse(existing);
        // If rubric version changed, keep notes/scores best-effort but bump version metadata.
        r.rubricVersion = r.rubricVersion || RUBRIC_VERSION;
        r.appVersion = APP_VERSION;
        ensureRatingShape(r, prop, rater);
        return r;
      } catch (_) { /* fall through */ }
    }
    var fresh = {
      submissionId: uuid(),
      rubricVersion: RUBRIC_VERSION,
      appVersion: APP_VERSION,
      property: prop.address,
      propertySlug: prop.slug,
      rater: rater,
      date: nowIso(),
      categories: {},
      overallNotes: '',
      rawTotal: 0,
      rawMax: 72,
      weightedTotal: 0,
      weightedMax: 168
    };
    ensureRatingShape(fresh, prop, rater);
    return fresh;
  }

  // Make sure the rating object has slots for every category/criterion in
  // the current rubric. Does not overwrite existing scores or notes.
  function ensureRatingShape(r, prop, rater) {
    r.property = prop.address;
    r.propertySlug = prop.slug;
    r.rater = rater;
    if (!r.categories) r.categories = {};
    RUBRIC.forEach(function (cat) {
      if (!r.categories[cat.id]) r.categories[cat.id] = { criteria: {}, categoryNote: '' };
      var cobj = r.categories[cat.id];
      if (!cobj.criteria) cobj.criteria = {};
      if (typeof cobj.categoryNote !== 'string') cobj.categoryNote = '';
      cat.criteria.forEach(function (c) {
        if (!cobj.criteria[c.id]) {
          cobj.criteria[c.id] = { name: c.name, weight: c.weight, score: null, note: '' };
        } else {
          // refresh name/weight in case rubric metadata changed
          cobj.criteria[c.id].name = c.name;
          cobj.criteria[c.id].weight = c.weight;
          if (typeof cobj.criteria[c.id].note !== 'string') cobj.criteria[c.id].note = '';
        }
      });
    });
  }

  function saveDraft() {
    if (!state.rating) return;
    recomputeTotals();
    LS.setItem(draftKey(state.rating.propertySlug, state.rating.rater), JSON.stringify(state.rating));
    setStatus('saved');
  }

  function recomputeTotals() {
    var raw = 0, weighted = 0;
    RUBRIC.forEach(function (cat) {
      cat.criteria.forEach(function (c) {
        var entry = state.rating.categories[cat.id].criteria[c.id];
        var s = (entry && typeof entry.score === 'number') ? entry.score : 0;
        raw += s;
        weighted += s * c.weight;
      });
    });
    state.rating.rawTotal = raw;
    state.rating.weightedTotal = Math.round(weighted * 10) / 10;
    state.rating.rawMax = 72;
    state.rating.weightedMax = 168;
  }

  function unansweredCount(cat) {
    var n = 0;
    cat.criteria.forEach(function (c) {
      var s = state.rating.categories[cat.id].criteria[c.id].score;
      if (s == null) n++;
    });
    return n;
  }

  // -------- submission queue --------

  function loadQueue() {
    try { return JSON.parse(LS.getItem('tr.queue') || '[]'); } catch (_) { return []; }
  }
  function saveQueue(q) { LS.setItem('tr.queue', JSON.stringify(q)); }

  function enqueueRating(rating) {
    var q = loadQueue();
    // Dedup by submissionId.
    if (!q.some(function (r) { return r.submissionId === rating.submissionId; })) {
      q.push(rating);
      saveQueue(q);
    }
    setStatus('queued');
  }

  async function flushQueue() {
    var pat = LS.getItem('tr.pat');
    var repo = LS.getItem('tr.repo');
    if (!pat || !repo) return { ok: 0, fail: 0, reason: 'no PAT/repo configured' };
    if (!navigator.onLine) return { ok: 0, fail: 0, reason: 'offline' };
    var q = loadQueue();
    var remaining = [];
    var ok = 0, fail = 0;
    for (var i = 0; i < q.length; i++) {
      var r = q[i];
      try {
        await submitRatingToGitHub(r, pat, repo);
        ok++;
      } catch (err) {
        // 401/403 -> stop, keep in queue
        if (err && (err.status === 401 || err.status === 403)) {
          remaining = remaining.concat(q.slice(i));
          fail += q.length - i;
          break;
        }
        // 409 -> already present; treat as success
        if (err && err.status === 422) {
          // unprocessable - keep, surface
          remaining.push(r); fail++;
        } else if (err && err.status === 409) {
          ok++;
        } else {
          remaining.push(r); fail++;
        }
      }
    }
    saveQueue(remaining);
    if (remaining.length === 0 && ok > 0) setStatus('submitted');
    else if (remaining.length > 0) setStatus('queued');
    return { ok: ok, fail: fail };
  }

  // Build the API payload and PUT it. Throws on non-2xx with .status set.
  async function submitRatingToGitHub(rating, pat, repo) {
    var path = buildRatingPath(rating);
    var url = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(path);
    var content = b64encode(JSON.stringify(rating, null, 2) + '\n');
    var body = {
      message: 'rating: ' + rating.rater + ' scores ' + rating.property,
      content: content
    };
    var res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var respBody = '';
      try { respBody = await res.text(); } catch (_) {}
      // 422 typically means file already exists at that path -- retry once
      // with a uuid-suffixed filename.
      if (res.status === 422 || res.status === 409) {
        var altPath = path.replace(/\.json$/, '-' + rating.submissionId.slice(0, 8) + '.json');
        var altUrl = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(altPath);
        var res2 = await fetch(altUrl, {
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + pat,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify(body)
        });
        if (!res2.ok) {
          var e2 = new Error('GitHub ' + res2.status);
          e2.status = res2.status;
          try { e2.detail = await res2.text(); } catch (_) {}
          throw e2;
        }
        return await res2.json();
      }
      var err = new Error('GitHub ' + res.status);
      err.status = res.status;
      err.detail = respBody;
      throw err;
    }
    return await res.json();
  }

  function buildRatingPath(rating) {
    // Filename uses safe chars only.
    var safeStamp = rating.date.replace(/[:+]/g, '-');
    return 'ratings/' + rating.propertySlug + '/' + rating.rater + '-' + safeStamp + '.json';
  }

  // -------- status badge --------

  function setStatus(s) {
    state.statusBadge = s;
    var b = $('#status-badge');
    if (!b) return;
    b.className = 'badge badge-' + s;
    b.textContent = s;
  }

  // -------- alerts (transient banner inside main) --------

  function flashAlert(msg, kind) {
    var main = $('#app');
    if (!main) return;
    var a = el('div', { class: 'alert alert-' + (kind || 'info'), text: msg });
    a.onclick = function () { if (a.parentNode) a.parentNode.removeChild(a); };
    main.insertBefore(a, main.firstChild);
    if (kind !== 'error') {
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 3500);
    }
  }

  // -------- screens --------

  function render() {
    var app = $('#app');
    app.innerHTML = '';
    $('#prev-btn').disabled = true;
    $('#next-btn').disabled = false;
    $('#next-btn').textContent = 'Next \u2192';
    $('#prev-btn').textContent = '\u2190 Back';
    $('#progress-pill').textContent = '';
    $('#back-btn').style.visibility = 'hidden';
    $('#settings-btn').style.visibility = 'visible';

    switch (state.screen) {
      case 'passphrase': return renderPassphrase(app);
      case 'name':       return renderName(app);
      case 'property':   return renderProperty(app);
      case 'category':   return renderCategory(app);
      case 'summary':    return renderSummary(app);
      case 'settings':   return renderSettings(app);
    }
  }

  function renderPassphrase(app) {
    $('#screen-title').textContent = 'Tour Rater';
    $('#settings-btn').style.visibility = 'hidden';
    $('#prev-btn').disabled = true;
    $('#next-btn').disabled = true;

    var stored = LS.getItem('tr.passphraseHash');
    var heading = stored ? 'Enter passphrase' : 'Set a passphrase';
    var hint = stored
      ? 'Shared with whoever scores tours. Stays on this device once entered.'
      : 'First time setup. Pick something you can text to the other rater. SHA-256 hashed; never sent anywhere.';

    var input = el('input', { type: 'password', id: 'pass-input', autocomplete: 'off' });
    var btn = el('button', {
      class: 'btn btn-block', text: stored ? 'Unlock' : 'Set passphrase',
      onclick: async function () {
        var v = input.value.trim();
        if (v.length < 4) { flashAlert('At least 4 characters.', 'warn'); return; }
        var h = await sha256Hex(v);
        if (stored) {
          if (h !== stored) { flashAlert('Wrong passphrase.', 'error'); return; }
        } else {
          LS.setItem('tr.passphraseHash', h);
        }
        markAuthed();
        state.screen = state.rater ? 'property' : 'name';
        render();
      }
    });

    app.appendChild(el('h2', { text: heading }));
    app.appendChild(el('p', { class: 'hint', text: hint }));
    app.appendChild(el('label', { text: 'Passphrase' }));
    app.appendChild(input);
    app.appendChild(btn);
    setTimeout(function () { input.focus(); }, 50);
  }

  function renderName(app) {
    $('#screen-title').textContent = 'Who is rating?';
    $('#prev-btn').disabled = true;
    $('#next-btn').disabled = true;

    ['drew', 'sherry'].forEach(function (name) {
      var b = el('button', {
        class: 'btn btn-block', text: name.charAt(0).toUpperCase() + name.slice(1),
        onclick: function () {
          state.rater = name;
          LS.setItem('tr.rater', name);
          state.screen = 'property';
          render();
        }
      });
      app.appendChild(b);
    });
  }

  function renderProperty(app) {
    $('#screen-title').textContent = 'Pick a property';
    $('#back-btn').style.visibility = 'visible';
    $('#back-btn').onclick = function () { state.screen = 'name'; render(); };
    $('#prev-btn').disabled = true;
    $('#next-btn').disabled = true;

    var raterLabel = el('p', { class: 'hint', text: 'Rating as: ' + state.rater });
    app.appendChild(raterLabel);

    var allProps = state.defaultProperties.slice();
    var custom = [];
    try { custom = JSON.parse(LS.getItem('tr.properties') || '[]'); } catch (_) {}
    custom.forEach(function (p) {
      if (!allProps.some(function (q) { return q.slug === p.slug; })) allProps.push(p);
    });

    var ul = el('ul', { class: 'prop-list' });
    allProps.forEach(function (p) {
      ul.appendChild(el('li', {
        text: p.address,
        onclick: function () {
          state.property = p;
          state.rating = loadOrCreateRating(p, state.rater);
          recomputeTotals();
          state.categoryIndex = 0;
          state.screen = 'category';
          render();
        }
      }));
    });
    app.appendChild(ul);

    app.appendChild(el('label', { text: 'Add new address' }));
    var input = el('input', { type: 'text', id: 'new-addr', placeholder: '123 Example St, St Paul' });
    app.appendChild(input);
    app.appendChild(el('button', {
      class: 'btn btn-secondary btn-block', text: 'Add property',
      onclick: function () {
        var addr = input.value.trim();
        if (!addr) return;
        var p = { address: addr, slug: slugify(addr) };
        var list = [];
        try { list = JSON.parse(LS.getItem('tr.properties') || '[]'); } catch (_) {}
        if (!list.some(function (q) { return q.slug === p.slug; })) {
          list.push(p);
          LS.setItem('tr.properties', JSON.stringify(list));
        }
        render();
      }
    }));
  }

  function renderCategory(app) {
    var cat = RUBRIC[state.categoryIndex];
    $('#screen-title').textContent = cat.name;
    $('#back-btn').style.visibility = 'visible';
    $('#back-btn').onclick = function () { state.screen = 'property'; render(); };

    // Property header
    app.appendChild(el('p', { class: 'hint',
      text: state.property.address + ' \u2014 ' + state.rater +
        ' \u2014 step ' + (state.categoryIndex + 1) + ' of ' + RUBRIC.length }));

    cat.criteria.forEach(function (c) {
      app.appendChild(renderCriterion(cat, c));
    });

    var noteLabel = el('label', { text: 'Notes for ' + cat.name + ' (optional)' });
    var noteArea = el('textarea', {
      id: 'cat-note',
      oninput: function () {
        state.rating.categories[cat.id].categoryNote = noteArea.value;
        saveDraft();
      }
    });
    noteArea.value = state.rating.categories[cat.id].categoryNote || '';
    app.appendChild(noteLabel);
    app.appendChild(noteArea);

    // Footer
    $('#prev-btn').disabled = false;
    $('#prev-btn').onclick = function () {
      if (state.categoryIndex === 0) {
        state.screen = 'property';
      } else {
        state.categoryIndex--;
      }
      render();
    };
    $('#next-btn').disabled = false;
    $('#next-btn').textContent = state.categoryIndex === RUBRIC.length - 1
      ? 'Summary \u2192' : 'Next \u2192';
    $('#next-btn').onclick = function () {
      if (state.categoryIndex < RUBRIC.length - 1) {
        state.categoryIndex++;
        state.screen = 'category';
      } else {
        state.screen = 'summary';
      }
      render();
    };

    var unanswered = unansweredCount(cat);
    $('#progress-pill').textContent = unanswered === 0
      ? 'all set'
      : unanswered + ' to score';
  }

  function renderCriterion(cat, c) {
    var entry = state.rating.categories[cat.id].criteria[c.id];
    var wrap = el('div', { class: 'criterion' });
    var head = el('div', { class: 'criterion-head' }, [
      el('div', { class: 'criterion-name', text: c.name }),
      el('div', { class: 'weight-badge', text: 'wt ' + c.weight })
    ]);
    wrap.appendChild(head);

    var row = el('div', { class: 'score-row' });
    SCORE_SCALE.forEach(function (s) {
      var btn = el('button', {
        class: 'score-btn',
        text: s.label,
        dataset: { selected: entry.score === s.value ? 'true' : 'false' },
        onclick: function () {
          entry.score = s.value;
          saveDraft();
          // re-render only this criterion's row by toggling selected attrs
          Array.from(row.children).forEach(function (b, i) {
            b.dataset.selected = SCORE_SCALE[i].value === s.value ? 'true' : 'false';
          });
          // refresh progress
          var unanswered = unansweredCount(cat);
          $('#progress-pill').textContent = unanswered === 0
            ? 'all set'
            : unanswered + ' to score';
        }
      });
      row.appendChild(btn);
    });
    wrap.appendChild(row);

    var help = el('div', { class: 'score-help' });
    SCORE_SCALE.forEach(function (s) {
      help.appendChild(el('div', { text: s.help }));
    });
    wrap.appendChild(help);

    var noteWrap = el('div', { class: 'note-area' + (entry.note ? ' open' : '') });
    var noteArea = el('textarea', {
      placeholder: 'Optional note',
      oninput: function () { entry.note = noteArea.value; saveDraft(); }
    });
    noteArea.value = entry.note || '';
    noteWrap.appendChild(noteArea);

    var toggle = el('button', {
      class: 'note-toggle',
      text: entry.note ? 'Edit note' : '+ Add note',
      onclick: function () {
        noteWrap.classList.toggle('open');
        if (noteWrap.classList.contains('open')) noteArea.focus();
      }
    });
    wrap.appendChild(toggle);
    wrap.appendChild(noteWrap);
    return wrap;
  }

  function renderSummary(app) {
    $('#screen-title').textContent = 'Summary';
    $('#back-btn').style.visibility = 'visible';
    $('#back-btn').onclick = function () {
      state.categoryIndex = RUBRIC.length - 1;
      state.screen = 'category';
      render();
    };

    recomputeTotals();

    app.appendChild(el('p', { class: 'hint',
      text: state.property.address + ' \u2014 ' + state.rater + ' \u2014 ' + state.rating.date }));

    RUBRIC.forEach(function (cat) {
      var box = el('div', { class: 'summary-cat' });
      box.appendChild(el('h3', { text: cat.name }));
      cat.criteria.forEach(function (c) {
        var entry = state.rating.categories[cat.id].criteria[c.id];
        var row = el('div', { class: 'summary-row' }, [
          el('div', { class: 'name', text: c.name }),
          el('div', { class: 'score',
            text: (entry.score == null ? '\u2014' : entry.score) + '/3' })
        ]);
        box.appendChild(row);
      });
      var cn = state.rating.categories[cat.id].categoryNote;
      if (cn) box.appendChild(el('p', { class: 'hint', text: 'Note: ' + cn }));
      app.appendChild(box);
    });

    var raw = state.rating.rawTotal;
    var weighted = state.rating.weightedTotal;
    var meetsPurchase = raw >= THRESHOLDS.purchaseRawMin;
    var totals = el('div', { class: 'totals' }, [
      el('div', { class: 'totals-row',
        text: 'Raw total: ' + raw + ' / ' + THRESHOLDS.rawMax }),
      el('div', { class: 'totals-row',
        text: 'Weighted total: ' + weighted + ' / ' + THRESHOLDS.weightedMax }),
      el('div', { class: 'totals-row major ' + (meetsPurchase ? 'threshold-met' : 'threshold-miss'),
        text: meetsPurchase
          ? 'Meets purchase threshold (>= ' + THRESHOLDS.purchaseRawMin + ')'
          : 'Below purchase threshold (' + THRESHOLDS.purchaseRawMin + ' needed)' })
    ]);
    app.appendChild(totals);

    app.appendChild(el('label', { text: 'Overall notes' }));
    var notes = el('textarea', {
      oninput: function () { state.rating.overallNotes = notes.value; saveDraft(); }
    });
    notes.value = state.rating.overallNotes || '';
    app.appendChild(notes);

    var submitBtn = el('button', {
      class: 'btn btn-block', text: 'Submit rating',
      onclick: async function () {
        recomputeTotals();
        // Update timestamp at submit time so it's the actual submit moment.
        state.rating.date = nowIso();
        var pat = LS.getItem('tr.pat');
        var repo = LS.getItem('tr.repo');
        saveDraft();
        if (!pat || !repo) {
          enqueueRating(state.rating);
          flashAlert('No PAT/repo set. Saved to queue.', 'warn');
          return;
        }
        if (!navigator.onLine) {
          enqueueRating(state.rating);
          flashAlert('Offline. Queued for upload.', 'warn');
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        try {
          await submitRatingToGitHub(state.rating, pat, repo);
          // success: clear draft, mark submitted
          LS.removeItem(draftKey(state.rating.propertySlug, state.rating.rater));
          setStatus('submitted');
          flashAlert('Submitted to GitHub.', 'ok');
          submitBtn.textContent = 'Submitted';
        } catch (err) {
          enqueueRating(state.rating);
          setStatus('error');
          var detail = err.detail ? '\n' + err.detail : '';
          if (err && (err.status === 401 || err.status === 403)) {
            flashAlert('GitHub auth failed (' + err.status + '). Check PAT in Settings. Queued.' + detail, 'error');
          } else if (err && err.status === 404) {
            flashAlert('Repo not found (404). Check repo name in Settings: ' + (LS.getItem('tr.repo') || 'empty') + detail, 'error');
          } else {
            flashAlert('Submit failed (' + (err && err.status ? err.status : 'network') + '). Queued.' + detail, 'error');
          }
          console.error('Tour Rater submit error:', err, detail);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Retry submit';
        }
      }
    });
    app.appendChild(submitBtn);

    $('#prev-btn').disabled = false;
    $('#prev-btn').onclick = function () {
      state.categoryIndex = RUBRIC.length - 1;
      state.screen = 'category';
      render();
    };
    $('#next-btn').textContent = 'Done';
    $('#next-btn').onclick = function () {
      // Done returns to property picker for next house.
      state.screen = 'property';
      state.property = null;
      state.rating = null;
      render();
    };
  }

  function renderSettings(app) {
    $('#screen-title').textContent = 'Settings';
    $('#back-btn').style.visibility = 'visible';
    $('#back-btn').onclick = function () {
      state.screen = state.settingsReturnTo || 'property';
      render();
    };
    $('#prev-btn').disabled = true;
    $('#next-btn').disabled = true;

    // GitHub config
    var gh = el('div', { class: 'settings-section' });
    gh.appendChild(el('h3', { text: 'GitHub' }));
    gh.appendChild(el('label', { text: 'Fine-grained PAT (Contents: read/write)' }));
    var patInput = el('input', { type: 'password', autocomplete: 'off' });
    patInput.value = LS.getItem('tr.pat') || '';
    gh.appendChild(patInput);
    gh.appendChild(el('label', { text: 'Repo (owner/name)' }));
    var repoInput = el('input', { type: 'text', placeholder: 'andrejo-msft/tour-rater' });
    repoInput.value = LS.getItem('tr.repo') || 'andrejo-msft/tour-rater';
    gh.appendChild(repoInput);
    gh.appendChild(el('button', {
      class: 'btn btn-block', text: 'Save GitHub settings',
      onclick: function () {
        LS.setItem('tr.pat', patInput.value.trim());
        LS.setItem('tr.repo', repoInput.value.trim());
        flashAlert('Saved.', 'ok');
      }
    }));
    app.appendChild(gh);

    // Pair device via QR
    var pair = el('div', { class: 'settings-section' });
    pair.appendChild(el('h3', { text: 'Pair another device' }));
    pair.appendChild(el('p', { class: 'hint',
      text: 'Generates a QR code containing PAT, repo, and passphrase hash. The other device scans it and is fully configured. Show only to people you trust.' }));
    var qrBox = el('div', { class: 'qr-container', id: 'qr-box' });
    pair.appendChild(qrBox);
    pair.appendChild(el('button', {
      class: 'btn btn-secondary btn-block', text: 'Show pairing QR',
      onclick: function () {
        var pat = LS.getItem('tr.pat');
        var repo = LS.getItem('tr.repo');
        var ph = LS.getItem('tr.passphraseHash');
        if (!pat || !repo || !ph) {
          var missing = [];
          if (!pat) missing.push('PAT');
          if (!repo) missing.push('repo');
          if (!ph) missing.push('passphrase');
          flashAlert('Missing: ' + missing.join(', ') + '. Save them above first.', 'warn');
          return;
        }
        var url = location.origin + location.pathname +
          '#setup=' + encodeURIComponent(pat) +
          '&repo=' + encodeURIComponent(repo) +
          '&ph=' + encodeURIComponent(ph);
        try {
          var qr = qrcode(0, 'L');
          qr.addData(url);
          qr.make();
          qrBox.innerHTML = qr.createSvgTag(4, 8);
        } catch (e) {
          flashAlert('QR generation failed: ' + e.message, 'error');
        }
      }
    }));
    // Fallback: copy setup link button
    pair.appendChild(el('button', {
      class: 'btn btn-secondary btn-block', text: 'Copy setup link instead',
      onclick: function () {
        var pat = LS.getItem('tr.pat');
        var repo = LS.getItem('tr.repo');
        var ph = LS.getItem('tr.passphraseHash');
        if (!pat || !repo || !ph) {
          var missing = [];
          if (!pat) missing.push('PAT');
          if (!repo) missing.push('repo');
          if (!ph) missing.push('passphrase');
          flashAlert('Missing: ' + missing.join(', ') + '. Save them above first.', 'warn');
          return;
        }
        var url = location.origin + location.pathname +
          '#setup=' + encodeURIComponent(pat) +
          '&repo=' + encodeURIComponent(repo) +
          '&ph=' + encodeURIComponent(ph);
        if (navigator.share) {
          navigator.share({ title: 'Tour Rater Setup', url: url });
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            flashAlert('Setup link copied to clipboard.', 'ok');
          });
        } else {
          prompt('Copy this link:', url);
        }
      }
    }));
    // Debug: show what's stored
    var debugInfo = el('p', { class: 'hint' });
    debugInfo.textContent = 'Stored: PAT=' + (LS.getItem('tr.pat') ? 'yes(' + LS.getItem('tr.pat').length + ' chars)' : 'NO') +
      ', repo=' + (LS.getItem('tr.repo') || 'NO') +
      ', passphrase=' + (LS.getItem('tr.passphraseHash') ? 'yes' : 'NO');
    pair.appendChild(debugInfo);
    app.appendChild(pair);

    // Passphrase
    var ps = el('div', { class: 'settings-section' });
    ps.appendChild(el('h3', { text: 'Passphrase' }));
    ps.appendChild(el('p', { class: 'hint', text: 'Change the shared passphrase. Both devices must update.' }));
    var newPass = el('input', { type: 'password', autocomplete: 'off', placeholder: 'New passphrase' });
    ps.appendChild(newPass);
    ps.appendChild(el('button', {
      class: 'btn btn-block', text: 'Set passphrase',
      onclick: async function () {
        var v = newPass.value.trim();
        if (v.length < 4) { flashAlert('At least 4 characters.', 'warn'); return; }
        var h = await sha256Hex(v);
        LS.setItem('tr.passphraseHash', h);
        flashAlert('Passphrase updated.', 'ok');
        newPass.value = '';
      }
    }));
    app.appendChild(ps);

    // Queue
    var q = loadQueue();
    var qs = el('div', { class: 'settings-section' });
    qs.appendChild(el('h3', { text: 'Submission queue' }));
    qs.appendChild(el('p', { class: 'hint', text: q.length + ' rating(s) queued.' }));
    qs.appendChild(el('button', {
      class: 'btn btn-block', text: 'Retry queued submissions',
      onclick: async function () {
        if (loadQueue().length === 0) { flashAlert('Queue is empty.', 'info'); return; }
        var r = await flushQueue();
        flashAlert('Flushed: ' + r.ok + ' ok, ' + r.fail + ' failed' +
          (r.reason ? ' (' + r.reason + ')' : ''), r.fail > 0 ? 'warn' : 'ok');
        render();
      }
    }));
    app.appendChild(qs);

    // Danger zone
    var dz = el('div', { class: 'settings-section' });
    dz.appendChild(el('h3', { text: 'Danger zone' }));
    dz.appendChild(el('button', {
      class: 'btn btn-danger btn-block', text: 'Clear all data on this device',
      onclick: function () {
        if (!confirm('Clear PAT, repo, drafts, queue, and passphrase from this device?')) return;
        Object.keys(LS).filter(function (k) { return k.indexOf('tr.') === 0; })
          .forEach(function (k) { LS.removeItem(k); });
        SS.removeItem('tr.authedSession');
        flashAlert('Cleared.', 'ok');
        location.reload();
      }
    }));
    app.appendChild(dz);

    // Version footer
    app.appendChild(el('p', { class: 'hint',
      text: 'app v' + APP_VERSION + ' \u00b7 rubric ' + RUBRIC_VERSION }));
  }

  // -------- top-level wiring --------

  function loadDefaultProperties(cb) {
    fetch('properties.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        state.defaultProperties = Array.isArray(data) ? data : [];
        cb();
      })
      .catch(function () { state.defaultProperties = []; cb(); });
  }

  function bindHeader() {
    $('#settings-btn').onclick = function () {
      if (state.screen === 'settings') return;
      state.settingsReturnTo = state.screen;
      state.screen = 'settings';
      render();
    };
  }

  function bindOnline() {
    window.addEventListener('online', function () {
      flushQueue().then(function (r) {
        if (r.ok > 0) flashAlert('Back online. Submitted ' + r.ok + ' queued.', 'ok');
      });
    });
  }

  function init() {
    var hadSetup = processSetupHash();
    bindHeader();
    bindOnline();
    setStatus(loadQueue().length > 0 ? 'queued' : 'idle');
    loadDefaultProperties(function () {
      if (!isAuthedThisSession() || !LS.getItem('tr.passphraseHash')) {
        state.screen = 'passphrase';
      } else if (!state.rater) {
        state.screen = 'name';
      } else {
        state.screen = 'property';
      }
      render();
      // Best-effort flush on load if anything was queued.
      if (navigator.onLine) flushQueue();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
