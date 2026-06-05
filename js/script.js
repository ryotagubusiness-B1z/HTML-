/* =====================================================================
 * ゲームブック フォーマット  -  script.js
 * ---------------------------------------------------------------------
 * data/data.csv と img/ 内のメディアを動的に読み込み、
 * 選択肢クリックでページを遷移するゲームブックを描画します。
 *
 * 【 CSV の項目（1行 = 1ページ）】 ※1行目はヘッダー（固定）
 *   page          : ページ番号           （整数 / 必須・重複不可）
 *                   ※ page=0 はタイトル画面として扱われます。
 *   text          : 本文                 （文字列 / 空欄可）
 *                   ※ page=0 のときは「作品名」としてブラウザのタブ名に使われます。
 *   image         : 画像 or 動画ファイル名 （文字列 / 空欄可・img/ からの相対）
 *   choice1_text  : 選択肢1のテキスト      （文字列 / 空欄可）
 *                   ※ page=0 では「はじめる」ボタンの文言（既定の遷移先は1）。
 *   choice1_to    : 選択肢1の遷移先ページ番号（整数 / 空欄可）
 *   choice2_text  : 選択肢2のテキスト
 *                   ※ page=0 では choice2_text を「クレジット」として下中央に表示
 *                     （choice2_to は不要／無効）。
 *   choice2_to    : 選択肢2の遷移先ページ番号
 *   choice3_text  : 選択肢3のテキスト
 *   choice3_to    : 選択肢3の遷移先ページ番号
 *
 *  - 選択肢は最大3つ。テキストと遷移先の両方が入っている選択肢のみ表示します。
 *  - 選択肢が1つも無いページは「物語の終わり」として扱われ、「おわり」と
 *    「TOPへ」ボタン（タイトル= page0 へ戻る）が表示されます。
 *  - image は拡張子で画像/動画を自動判定します（mp4, mov, mpg 等は動画）。
 *  - 文字コードは UTF-8（BOM 付き可）で保存してください。
 *  - 本文やテキストにカンマ・改行・ダブルクォートを含める場合は、
 *    そのセルを " " で囲ってください（" は "" で表現）。Excel の通常保存と同じ仕様です。
 *
 *  ※ 別作品へ流用する場合は data/data.csv と img/ の中身を差し替えるだけでOKです。
 *
 * 【 データの読み込み方式（3パターンに自動対応）】
 *   ① fetch        : ローカルサーバー / Web公開時。data/data.csv を直接読み込む。
 *   ② 埋め込み      : data/data.js に window.GAMEBOOK_CSV があればそれを使用。
 *                     → index.html をダブルクリック(file://)しても動く。配布向け。
 *                     （tools/csv-to-js.html で data.csv から data.js を生成できます）
 *   ③ ファイル選択  : 上記いずれも使えない場合、CSV選択画面を表示し、
 *                     ユーザーが選んだ/ドロップしたCSVを FileReader で読み込む。
 *   読み込み順は ① → ②(fetch失敗時) → ③(②も無い時) です。
 * ===================================================================== */

(function () {
  'use strict';

  // ---- 設定 -------------------------------------------------------------
  var CSV_PATH = 'data/data.csv';   // CSV の場所
  var IMG_DIR  = 'img/';            // 画像・動画フォルダ
  var VIDEO_EXT = ['mp4', 'mpg', 'mpeg', 'mov', 'm4v', 'webm', 'ogv']; // 動画とみなす拡張子
  var TITLE_PAGE = '0';             // タイトル画面として扱うページ番号

  // ---- 要素参照 ---------------------------------------------------------
  var screens = {
    game:    document.getElementById('game-screen'),
    loading: document.getElementById('loading-screen'),
    error:   document.getElementById('error-screen'),
    picker:  document.getElementById('picker-screen')
  };
  var els = {
    pageEl:    document.getElementById('page'),
    media:     document.getElementById('page-media'),
    text:      document.getElementById('page-text'),
    choices:   document.getElementById('page-choices'),
    credit:    document.getElementById('page-credit'),
    errorMsg:  document.getElementById('error-message'),
    fileInput: document.getElementById('csv-file-input'),
    dropZone:  document.getElementById('csv-drop-zone')
  };

  // ページ番号(string) -> ページオブジェクト の対応表
  var pages = {};
  var firstPageId = null; // 最初のページ番号（CSVの先頭データ行）

  // ---- 起動 -------------------------------------------------------------
  showScreen('loading');

  loadData()
    .then(function (text) {
      var rows = parseCsv(text);
      buildPages(rows);
      // ハッシュ変更でページ遷移（ブラウザの戻る/進むが効く）
      window.addEventListener('hashchange', render);
      render(); // 初回描画
    })
    .catch(function (err) {
      showError(
        'データの読み込みに失敗しました。\n' +
        '・data/data.csv が存在するか確認してください。\n' +
        '・CSVの内容を確認してください。\n\n' +
        '詳細: ' + err.message
      );
    });

  // =====================================================================
  // データ読み込み（① fetch → ② 埋め込み → ③ ファイル選択 の順に自動対応）
  // =====================================================================
  function loadData() {
    return loadCsv(CSV_PATH)
      .then(function (text) { return text; })          // ① サーバー/Web公開
      .catch(function () {
        if (typeof window.GAMEBOOK_CSV === 'string' && window.GAMEBOOK_CSV.trim() !== '') {
          return window.GAMEBOOK_CSV;                   // ② 埋め込み(file://でも動作)
        }
        return waitForUserFile();                       // ③ ユーザーにCSVを選ばせる
      });
  }

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

  // ③ CSV選択画面を表示し、選択/ドロップされたファイルの中身を返す
  function waitForUserFile() {
    return new Promise(function (resolve, reject) {
      showScreen('picker');

      function handleFile(file) {
        if (!file) { return; }
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(new Error('ファイルの読み込みに失敗しました。')); };
        reader.readAsText(file, 'UTF-8');
      }

      els.fileInput.addEventListener('change', function () {
        handleFile(els.fileInput.files && els.fileInput.files[0]);
      });

      // ドラッグ＆ドロップ対応
      var dz = els.dropZone;
      ['dragenter', 'dragover'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) {
          e.preventDefault();
          dz.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) {
          e.preventDefault();
          dz.classList.remove('is-dragover');
        });
      });
      dz.addEventListener('drop', function (e) {
        var dt = e.dataTransfer;
        handleFile(dt && dt.files && dt.files[0]);
      });
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
      if (c === '\r') {
        if (text[i + 1] === '\n') { // CRLF → \r を捨て、次の \n で改行確定
          i++;
          continue;
        }
        // CR単独（旧Mac形式）も改行として扱う
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
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

      if (Object.prototype.hasOwnProperty.call(pages, id)) {
        // ページ番号は重複不可。制作ミスに気づけるよう通知（後の行で上書き）
        console.warn('ページ番号「' + id + '」が重複しています。後の行で上書きされます。');
      }

      var pageObj = {
        id: id,
        text: col(cells, 'text'),
        image: col(cells, 'image'),
        choices: choices
      };
      // タイトルページ(page=0)は choice2_text をクレジットとして使う（遷移先は不要）
      if (id === TITLE_PAGE) {
        pageObj.credit = col(cells, 'choice2_text');
      }
      pages[id] = pageObj;

      if (firstPageId === null) {
        firstPageId = id;
      }
    }

    if (firstPageId === null) {
      throw new Error('有効なページが1件もありません。');
    }

    // 遷移先のリンク切れを検出して通知（実行は止めない。制作支援用）
    Object.keys(pages).forEach(function (pid) {
      pages[pid].choices.forEach(function (ch) {
        if (!Object.prototype.hasOwnProperty.call(pages, ch.to)) {
          console.warn('ページ' + pid + 'の選択肢「' + ch.text + '」の遷移先ページ「' + ch.to + '」が存在しません。');
        }
      });
    });
  }

  // =====================================================================
  // 画面遷移
  // =====================================================================
  function getCurrentPageId() {
    var h = location.hash.replace(/^#/, '');
    try {
      return decodeURIComponent(h);
    } catch (e) {
      // 不正な % エンコード（例: #100%）でも落とさず、生文字列を返す
      return h;
    }
  }

  function render() {
    var id = getCurrentPageId();

    // ハッシュ無し → タイトル画面（page=0）。開き直すと必ずタイトルに戻る。
    if (id === '') {
      id = TITLE_PAGE;
    }

    // hasOwnProperty で判定（"toString" 等の継承プロパティ誤ヒットを防ぐ）
    if (!Object.prototype.hasOwnProperty.call(pages, id)) {
      // タイトル(page0)が未定義のCSVでも動くよう、先頭ページにフォールバック
      if (id === TITLE_PAGE && firstPageId !== null) {
        id = firstPageId;
      } else {
        showError('ページ「' + id + '」が見つかりません。CSVの遷移先を確認してください。');
        return;
      }
    }

    renderPage(pages[id], id === TITLE_PAGE);
    showScreen('game');
    // 新しいページの先頭へスクロール
    window.scrollTo(0, 0);
  }

  // =====================================================================
  // ページ描画
  // =====================================================================
  function renderPage(page, isTitle) {
    // タイトル専用レイアウト用のクラス切り替え
    if (isTitle) {
      els.pageEl.classList.add('is-title');
      if (page.text) { document.title = page.text; } // 作品名をタブ名に
    } else {
      els.pageEl.classList.remove('is-title');
    }

    // --- メディア（画像 or 動画） ---
    els.media.innerHTML = '';
    if (page.image) {
      els.media.appendChild(createMedia(page.image));
      els.media.hidden = false;
    } else {
      els.media.hidden = true;
    }

    // --- 本文 ---
    // タイトルページでは本文は表示しない（text は作品名としてタブ名に使用）
    if (!isTitle && page.text) {
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
        els.choices.appendChild(makeNavButton(choice.text, choice.to));
      });
    } else if (!isTitle) {
      // 選択肢が無い = 物語の終わり（タイトルページでは出さない）
      var end = document.createElement('p');
      end.className = 'the-end';
      end.textContent = 'おわり';
      els.choices.appendChild(end);
      // TOPへ（タイトル= page0 へ戻る）
      var top = makeNavButton('TOPへ', TITLE_PAGE);
      top.classList.add('top-btn');
      els.choices.appendChild(top);
    }
    els.choices.hidden = false;

    // --- クレジット（タイトルページのみ・下中央） ---
    if (isTitle && page.credit) {
      els.credit.textContent = page.credit;
      els.credit.hidden = false;
    } else {
      els.credit.textContent = '';
      els.credit.hidden = true;
    }
  }

  // 遷移ボタンを生成
  function makeNavButton(text, to) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.textContent = text;
    btn.addEventListener('click', function () {
      location.hash = '#' + to;
    });
    return btn;
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
      video.onerror = function () { this.style.display = 'none'; }; // 動画欠損時は隠す（画像と挙動を揃える）
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
