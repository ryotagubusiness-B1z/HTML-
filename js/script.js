/* =====================================================================
 * ゲームブック フォーマット  -  script.js
 * ---------------------------------------------------------------------
 * data/data.csv と img/ 内のメディアを動的に読み込み、
 * 選択肢クリックでページを遷移するゲームブックを描画します。
 *
 * 【 CSV の項目（1行 = 1ページ）】 ※1行目はヘッダー（固定）
 *   page          : ページ番号           （整数 / 必須・重複不可）
 *   text          : 本文                 （文字列 / 空欄可）
 *   image         : 画像 or 動画ファイル名 （文字列 / 空欄可・img/ からの相対）
 *   choice1_text  : 選択肢1のテキスト      （文字列 / 空欄可）
 *   choice1_to    : 選択肢1の遷移先ページ番号（整数 / 空欄可）
 *   choice2_text  : 選択肢2のテキスト
 *   choice2_to    : 選択肢2の遷移先ページ番号
 *   choice3_text  : 選択肢3のテキスト
 *   choice3_to    : 選択肢3の遷移先ページ番号
 *
 *  - 選択肢は最大3つ。テキストと遷移先の両方が入っている選択肢のみ表示します。
 *  - 選択肢が1つも無いページは「物語の終わり」として扱われます。
 *  - image は拡張子で画像/動画を自動判定します（mp4, mov, mpg 等は動画）。
 *  - 文字コードは UTF-8（BOM 付き可）で保存してください。
 *  - 本文やテキストにカンマ・改行・ダブルクォートを含める場合は、
 *    そのセルを " " で囲ってください（" は "" で表現）。Excel の通常保存と同じ仕様です。
 *
 *  ※ 別作品へ流用する場合は data/data.csv と img/ の中身を差し替えるだけでOKです。
 * ===================================================================== */

(function () {
  'use strict';

  // ---- 設定 -------------------------------------------------------------
  var CSV_PATH = 'data/data.csv';   // CSV の場所
  var IMG_DIR  = 'img/';            // 画像・動画フォルダ
  var VIDEO_EXT = ['mp4', 'mpg', 'mpeg', 'mov', 'm4v', 'webm', 'ogv']; // 動画とみなす拡張子

  // ---- 要素参照 ---------------------------------------------------------
  var screens = {
    title:   document.getElementById('title-screen'),
    game:    document.getElementById('game-screen'),
    loading: document.getElementById('loading-screen'),
    error:   document.getElementById('error-screen')
  };
  var els = {
    media:    document.getElementById('page-media'),
    text:     document.getElementById('page-text'),
    choices:  document.getElementById('page-choices'),
    startBtn: document.getElementById('start-btn'),
    errorMsg: document.getElementById('error-message')
  };

  // ページ番号(string) -> ページオブジェクト の対応表
  var pages = {};
  var firstPageId = null; // 最初のページ番号（CSVの先頭データ行）

  // ---- 起動 -------------------------------------------------------------
  showScreen('loading');

  loadCsv(CSV_PATH)
    .then(function (text) {
      var rows = parseCsv(text);
      buildPages(rows);
      // ハッシュ変更でページ遷移（ブラウザの戻る/進むが効く）
      window.addEventListener('hashchange', render);
      els.startBtn.addEventListener('click', startGame);
      render(); // 初回描画
    })
    .catch(function (err) {
      showError(
        'データの読み込みに失敗しました。\n' +
        '・data/data.csv が存在するか確認してください。\n' +
        '・ファイルを直接開いた場合は、ローカルサーバー経由で開いてください。\n\n' +
        '詳細: ' + err.message
      );
    });

  // =====================================================================
  // CSV 読み込み
  // =====================================================================
  function loadCsv(path) {
    // キャッシュ無効化のため日時を付与（CSV編集後の再読み込みを確実にする）
    var url = path + '?t=' + Date.now();
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' (' + path + ')');
      }
      return res.text();
    });
  }

  // =====================================================================
  // CSV パーサ（ダブルクォート・改行・"" エスケープに対応）
  //   戻り値: 文字列セルの二次元配列
  // =====================================================================
  function parseCsv(text) {
    // 先頭のBOMを除去
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    while (i < len) {
      var c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { // "" → " （エスケープ）
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (c === '\r') { // CRLF / CR
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
    // 最終フィールド・行
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // =====================================================================
  // CSV行 -> ページ辞書 の構築
  // =====================================================================
  function buildPages(rows) {
    if (!rows.length) {
      throw new Error('CSVが空です。');
    }

    // ヘッダー行から列名 -> インデックスの対応を作成（列順が変わっても動くように）
    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = {};
    header.forEach(function (name, i) { idx[name] = i; });

    function col(cells, name) {
      var i = idx[name];
      return (i === undefined || cells[i] === undefined) ? '' : cells[i].trim();
    }

    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      // 完全な空行はスキップ
      if (cells.every(function (v) { return v.trim() === ''; })) {
        continue;
      }

      var id = col(cells, 'page');
      if (id === '') {
        continue; // ページ番号が無い行は無視
      }

      var choices = [];
      for (var n = 1; n <= 3; n++) {
        var ctext = col(cells, 'choice' + n + '_text');
        var cto   = col(cells, 'choice' + n + '_to');
        if (ctext !== '' && cto !== '') {
          choices.push({ text: ctext, to: cto });
        }
      }

      pages[id] = {
        id: id,
        text: col(cells, 'text'),
        image: col(cells, 'image'),
        choices: choices
      };

      if (firstPageId === null) {
        firstPageId = id;
      }
    }

    if (firstPageId === null) {
      throw new Error('有効なページが1件もありません。');
    }
  }

  // =====================================================================
  // 画面遷移
  // =====================================================================
  function startGame() {
    location.hash = '#' + firstPageId;
  }

  function getCurrentPageId() {
    var h = location.hash.replace(/^#/, '');
    return decodeURIComponent(h);
  }

  function render() {
    var id = getCurrentPageId();

    // ハッシュ無し → タイトル画面（開き直すと必ずタイトルに戻る）
    if (id === '') {
      showScreen('title');
      return;
    }

    var page = pages[id];
    if (!page) {
      showError('ページ「' + id + '」が見つかりません。CSVの遷移先を確認してください。');
      return;
    }

    renderPage(page);
    showScreen('game');
    // 新しいページの先頭へスクロール
    window.scrollTo(0, 0);
  }

  // =====================================================================
  // ページ描画
  // =====================================================================
  function renderPage(page) {
    // --- メディア（画像 or 動画） ---
    els.media.innerHTML = '';
    if (page.image) {
      var node = createMedia(page.image);
      els.media.appendChild(node);
      els.media.hidden = false;
    } else {
      els.media.hidden = true;
    }

    // --- 本文（空なら非表示） ---
    if (page.text) {
      els.text.textContent = page.text; // 改行はCSS(white-space)で反映
      els.text.hidden = false;
    } else {
      els.text.textContent = '';
      els.text.hidden = true;
    }

    // --- 選択肢 ---
    els.choices.innerHTML = '';
    if (page.choices.length > 0) {
      page.choices.forEach(function (choice) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.addEventListener('click', function () {
          location.hash = '#' + choice.to;
        });
        els.choices.appendChild(btn);
      });
      els.choices.hidden = false;
    } else {
      // 選択肢が無い = 物語の終わり
      var end = document.createElement('p');
      end.className = 'the-end';
      end.textContent = 'おわり';
      els.choices.appendChild(end);
      els.choices.hidden = false;
    }
  }

  // 拡張子から画像/動画を判定して要素を生成
  function createMedia(filename) {
    var ext = (filename.split('.').pop() || '').toLowerCase();
    var src = IMG_DIR + filename;

    if (VIDEO_EXT.indexOf(ext) !== -1) {
      var video = document.createElement('video');
      video.className = 'media-el';
      video.src = src;
      video.controls = true;
      video.playsInline = true;
      video.setAttribute('playsinline', ''); // iOS Safari
      return video;
    }

    var img = document.createElement('img');
    img.className = 'media-el';
    img.src = src;
    img.alt = '';
    img.onerror = function () { this.style.display = 'none'; }; // 画像欠損時は隠す
    return img;
  }

  // =====================================================================
  // 画面の表示切り替え
  // =====================================================================
  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = (key !== name);
    });
  }

  function showError(message) {
    els.errorMsg.textContent = message;
    showScreen('error');
  }
})();
