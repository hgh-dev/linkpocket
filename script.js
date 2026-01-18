/* [v1.24.0] Link Pocket 기능 스크립트
  - 목표: 사이드바 폴더 순서 변경을 드래그 앤 드롭으로 개선
*/

// ============================================================
// 1. 라이브러리 가져오기 (Import)
// ============================================================
// 마치 요리하기 전에 마트에서 재료를 사오는 것과 같습니다.
// 구글이 만들어둔 '인증(로그인)'과 '데이터베이스(저장소)' 기능을 가져옵니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, push, onValue, remove, update, off, set }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ============================================================
// 2. 전역 변수 설정 (Variables)
// ============================================================
// 앱 전체에서 계속 기억해야 할 값들을 미리 그릇에 담아둡니다.

// [공유 기능] 다른 앱에서 공유하기로 넘어온 링크를 잠시 보관하는 변수
let pendingSharedLink = null;

// [사용자 정보] 현재 로그인한 사람 (없으면 null)
let currentUser = null;

// [데이터베이스 주소] 내 데이터가 저장된 위치(폴더 경로 같은 개념)
let dbLinksRef = null;   // 링크 저장소
let dbFoldersRef = null; // 폴더 저장소

// [필터 상태] 현재 화면에 보여줄 기준
let currentFilter = 'all';        // 카테고리 (전체, 유튜브, 뉴스 등)
let currentFolderFilter = 'all';  // 폴더 (전체, 특정폴더)

// [데이터 저장소] 서버나 로컬에서 가져온 데이터를 메모리에 쥐고 있는 곳
let allLinksData = {};
let allFoldersData = {};

// [화면 상태] 정렬, 체크모드 등
let isAscending = false; // false면 최신순(내림차순)
let isCheckMode = false; // 여러 개 선택 모드인지?
let selectedKeys = new Set(); // 선택된 카드들의 ID 목록
let pressTimer = null;   // 꾹 누르기 시간 측정용
let editingKey = null;   // 현재 수정 중인 링크의 ID
let activeMenuKey = null;// 현재 메뉴가 열려있는 카드의 ID

// [v1.24.0] 폴더 순서 변경 모드용 변수
let isFolderOrderMode = false;
let draggedItemKey = null; // 드래그 중인 폴더의 ID

// [로컬 저장소 키] 게스트 모드일 때 브라우저에 저장할 이름
const LOCAL_LINKS_KEY = 'linkpocket_guest_data';
const LOCAL_FOLDERS_KEY = 'linkpocket_guest_folders';


// ============================================================
// 3. 초기 설정 (Configuration)
// ============================================================

// 웹사이트가 켜지자마자 실행되는 부분 (공유 링크 처리)
window.addEventListener('DOMContentLoaded', () => {
    const parsedUrl = new URL(window.location);
    const title = parsedUrl.searchParams.get('title');
    const text = parsedUrl.searchParams.get('text');
    const url = parsedUrl.searchParams.get('url');

    // 텍스트 안에 URL이 섞여 있을 경우 추출
    let finalLink = url;
    if (!finalLink && text && text.includes('http')) {
        const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) finalLink = urlMatch[0];
    }

    // 공유된 링크가 있다면 입력창에 넣고, 로그인 완료 대기
    if (finalLink) {
        document.getElementById('linkInput').value = finalLink;
        pendingSharedLink = finalLink;
        // 주소창 지저분해지지 않게 파라미터 청소
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

// Firebase 연결 설정 (내 프로젝트의 비밀키 등)
const firebaseConfig = {
    apiKey: "AIzaSyCe1JUNMAeLXlHInMCZ1fcf7zONLjUMR_8",
    authDomain: "linkpocket-75dae.firebaseapp.com",
    databaseURL: "https://linkpocket-75dae-default-rtdb.firebaseio.com",
    projectId: "linkpocket-75dae",
    storageBucket: "linkpocket-75dae.firebasestorage.app",
    messagingSenderId: "964808632824",
    appId: "1:964808632824:web:2ab9fcb6a4dfebc7f04e0d",
    measurementId: "G-XM687X6CLN"
};

// 앱 시작!
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();


// ============================================================
// 4. 게스트(비로그인) 모드용 함수
// ============================================================

// 게스트용 기본 폴더를 만듭니다.
function initGuestFolders() {
    let folders = localStorage.getItem(LOCAL_FOLDERS_KEY);
    if (!folders) {
        const defaultFolders = {
            'folder_1': { name: '폴더1', timestamp: Date.now(), order: 0 },
            'folder_2': { name: '폴더2', timestamp: Date.now() + 1, order: 1 }
        };
        localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(defaultFolders));
        return defaultFolders;
    }
    return JSON.parse(folders);
}


// ============================================================
// 5. 로그인 상태 감지 (Auth Listener)
// ============================================================
// 사용자가 들어오거나(로그인), 나갈 때(로그아웃) 자동으로 실행됩니다.
onAuthStateChanged(auth, (user) => {
    // HTML 요소들을 변수에 담습니다.
    const loginBtn = document.getElementById('headerLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userPhoto = document.getElementById('userPhoto');
    const userName = document.getElementById('userName');
    const guestNotice = document.getElementById('guestNotice');

    if (user) {
        // [로그인 성공 상태]
        currentUser = user;

        // UI 변경: 로그인 버튼 숨기고 로그아웃 버튼 보여주기
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
        guestNotice.style.display = 'none';
        userName.innerText = user.displayName;
        userPhoto.src = user.photoURL;

        // 데이터베이스 주소 설정 (users / 내 아이디 / links)
        dbLinksRef = ref(db, 'users/' + user.uid + '/links');
        dbFoldersRef = ref(db, 'users/' + user.uid + '/folders');

        // 데이터 실시간 감시 시작
        startListeningData();

        // 공유된 링크가 있었다면 지금 저장
        if (pendingSharedLink) {
            addLink();
            pendingSharedLink = null;
        }

    } else {
        // [로그아웃 / 게스트 상태]
        // 기존 연결 끊기 (메모리 누수 방지)
        if (dbLinksRef) off(dbLinksRef);
        if (dbFoldersRef) off(dbFoldersRef);

        currentUser = null;

        // UI 변경
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
        guestNotice.style.display = 'block';
        userName.innerText = 'Guest';
        userPhoto.src = 'https://ssl.gstatic.com/images/branding/product/1x/avatar_circle_grey_512dp.png';

        // 로컬 저장소(내 컴퓨터)에서 데이터 가져오기
        const localData = localStorage.getItem(LOCAL_LINKS_KEY);
        allLinksData = localData ? JSON.parse(localData) : {};
        allFoldersData = initGuestFolders();

        ensureFolderOrders(); // 폴더 순서 정리

        renderSidebar(); // 사이드바 그리기
        renderList();    // 목록 그리기

        if (pendingSharedLink) {
            addLink();
            pendingSharedLink = null;
        }
    }
});


// ============================================================
// 6. 버튼 이벤트 연결 (Event Listeners)
// ============================================================
// HTML에 있는 버튼들을 눌렀을 때 무슨 함수를 실행할지 정해줍니다.

// 상단 버튼들
document.getElementById('headerLoginBtn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
document.getElementById('addBtn').addEventListener('click', addLink);
document.getElementById('sortBtn').addEventListener('click', toggleSort);
document.getElementById('menuBtn').addEventListener('click', openSidebar);
document.getElementById('selectModeBtn').addEventListener('click', toggleSelectMode);
document.getElementById('folderOrderBtn').addEventListener('click', toggleFolderOrderMode); // [v1.24.0] 순서 변경 버튼

// 위험 구역 버튼들
document.getElementById('cleanBtn').addEventListener('click', deleteNonFavorites);
document.getElementById('resetBtn').addEventListener('click', resetAll);

// 선택 모드 하단 바 버튼들
document.getElementById('cancelSelBtn').addEventListener('click', exitCheckMode);
document.getElementById('moveSelBtn').addEventListener('click', () => openFolderModal());
document.getElementById('deleteSelBtn').addEventListener('click', deleteSelectedItems);

// 검색창 입력 감지
document.getElementById('searchInput').addEventListener('keyup', () => renderList());

// 모달(팝업) 관련 버튼들
document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);
document.getElementById('saveEditBtn').addEventListener('click', saveEdit);
document.getElementById('cancelFolderBtn').addEventListener('click', () => document.getElementById('folderModal').classList.remove('open'));
document.getElementById('closeSidebarBtn').addEventListener('click', closeSidebar);
document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
document.getElementById('addNewFolderBtn').addEventListener('click', addNewFolder);

// 화면 아무 데나 눌렀을 때 팝업 닫기
window.addEventListener('click', (e) => {
    if (!e.target.closest('.more-btn') && !e.target.closest('.more-menu-popup')) {
        closeAllMenus();
    }
});

// 카테고리 탭 버튼들
const categories = ['favorite', 'all', 'youtube', 'music', 'news', 'sns', 'shopping', 'community', 'web'];
categories.forEach(cat => {
    document.getElementById(`tab-${cat}`).addEventListener('click', () => filterList(cat));
});
document.getElementById('tab-search').addEventListener('click', () => filterList('search'));


// ============================================================
// 7. 데이터 관리 함수 (Data Logic)
// ============================================================

// [실시간 데이터 수신] 서버 DB가 바뀌면 내 화면도 즉시 바뀝니다.
function startListeningData() {
    // 링크 데이터 감시
    onValue(dbLinksRef, (snapshot) => {
        allLinksData = snapshot.val() || {};
        renderList();
        renderSidebar();
    });

    // 폴더 데이터 감시
    onValue(dbFoldersRef, (snapshot) => {
        const val = snapshot.val();
        if (!val) {
            // 폴더가 하나도 없으면 기본 폴더 생성
            const defaultFolders = {
                'folder_1': { name: '폴더1', timestamp: Date.now(), order: 0 },
                'folder_2': { name: '폴더2', timestamp: Date.now() + 1, order: 1 }
            };
            update(dbFoldersRef, defaultFolders);
        } else {
            allFoldersData = val;
            ensureFolderOrders();
            renderSidebar();
            renderList();
        }
    });
}

// [폴더 순서 보정] 순서 번호(order)가 없는 옛날 데이터를 위해 번호를 붙여줍니다.
function ensureFolderOrders() {
    let needsUpdate = false;
    // 배열로 변환해서 정렬
    const sorted = Object.entries(allFoldersData).sort((a, b) => {
        if (a[1].order !== undefined && b[1].order !== undefined) {
            return a[1].order - b[1].order;
        }
        return a[1].timestamp - b[1].timestamp;
    });

    // 다시 번호표(0, 1, 2...) 붙이기
    sorted.forEach(([key, folder], index) => {
        if (folder.order !== index) {
            allFoldersData[key].order = index;
            needsUpdate = true;
        }
    });

    // 변경사항이 있으면 저장
    if (needsUpdate) {
        if (currentUser) {
            update(dbFoldersRef, allFoldersData);
        } else {
            localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(allFoldersData));
        }
    }
}

// ============================================================
// 8. 사이드바 및 폴더 관련 함수
// ============================================================

function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('show');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
    // 사이드바 닫으면 편집 모드도 종료
    if (isFolderOrderMode) toggleFolderOrderMode();
}

function addNewFolder() {
    const name = prompt("새 폴더 이름을 입력하세요:");
    if (!name) return;

    // 현재 가장 큰 순서 번호를 찾아서 그 뒤에 추가
    const maxOrder = Object.values(allFoldersData).reduce((max, f) => Math.max(max, f.order || 0), -1);
    const newOrder = maxOrder + 1;

    if (currentUser) {
        push(dbFoldersRef, { name: name, timestamp: Date.now(), order: newOrder });
    } else {
        const newKey = 'folder_' + Date.now();
        allFoldersData[newKey] = { name: name, timestamp: Date.now(), order: newOrder };
        localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(allFoldersData));
        renderSidebar();
    }
}

// [v1.24.0] 순서 변경 모드 토글 (켜기/끄기)
function toggleFolderOrderMode() {
    isFolderOrderMode = !isFolderOrderMode; // 상태 반전 (True <-> False)
    
    const btn = document.getElementById('folderOrderBtn');
    const sidebar = document.getElementById('sidebar');

    if (isFolderOrderMode) {
        btn.innerText = '완료';
        btn.classList.add('active');
        sidebar.classList.add('edit-mode'); // CSS 스타일 적용용 클래스
    } else {
        btn.innerText = '⇅ 순서';
        btn.classList.remove('active');
        sidebar.classList.remove('edit-mode');
    }
    
    renderSidebar(); // 화면 다시 그리기
}

// [v1.24.0] 사이드바 그리기 (드래그 기능 포함)
function renderSidebar() {
    const list = document.getElementById('sidebarList');
    list.innerHTML = '';

    // 1. 고정 메뉴 (전체, 미분류) - 순서 변경 모드일 때는 숨기기
    if (!isFolderOrderMode) {
        const totalCount = Object.keys(allLinksData).length;
        list.appendChild(createSidebarItem('all', '전체', totalCount, false));

        const unclassifiedCount = Object.values(allLinksData).filter(l => !l.folderId).length;
        list.appendChild(createSidebarItem('unclassified', '미분류', unclassifiedCount, false));
        
        // 구분선
        const hr = document.createElement('div');
        hr.style.borderBottom = '1px solid #eee';
        hr.style.margin = '10px 0';
        list.appendChild(hr);
    }

    // 2. 내 폴더들 (순서대로 정렬)
    const sortedFolders = Object.entries(allFoldersData).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    sortedFolders.forEach(([key, folder]) => {
        const count = Object.values(allLinksData).filter(l => l.folderId === key).length;
        // isDraggable 인자를 true로 전달 (편집 모드일 때만)
        const item = createSidebarItem(key, folder.name, count, isFolderOrderMode);
        
        // [편집 모드] 수정/삭제 버튼 추가
        if (isFolderOrderMode) {
            const btnGroup = document.createElement('div');
            btnGroup.className = 'folder-actions';

            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✎';
            editBtn.className = 'folder-manage-btn';
            editBtn.onclick = (e) => { e.stopPropagation(); updateFolder(key, folder.name); };

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '&times;';
            delBtn.className = 'folder-manage-btn';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(key, folder.name); };

            btnGroup.appendChild(editBtn);
            btnGroup.appendChild(delBtn);
            item.appendChild(btnGroup);
        }

        list.appendChild(item);
    });
}

// [v1.24.0] 사이드바 아이템 생성 (드래그 이벤트 연결)
function createSidebarItem(key, name, count, isDraggable) {
    const div = document.createElement('div');
    div.className = `folder-item ${currentFolderFilter === key ? 'active' : ''}`;
    
    // 드래그 핸들(손잡이) 아이콘
    const handle = isDraggable ? '<span class="drag-handle">≡</span>' : '';
    div.innerHTML = `${handle}<span>${name} <span class="folder-count">${count}</span></span>`;

    if (isDraggable) {
        // [드래그 기능 활성화]
        div.draggable = true;
        div.dataset.key = key; // HTML 태그에 폴더 ID 심어두기

        // 1. 드래그 시작 (잡았다!)
        div.addEventListener('dragstart', (e) => {
            draggedItemKey = key;
            e.target.classList.add('dragging'); // 투명하게 만들기
            // 모바일 등에서 텍스트가 선택되는 부작용 방지
            e.dataTransfer.effectAllowed = 'move'; 
        });

        // 2. 드래그 끝 (놓았다!)
        div.addEventListener('dragend', (e) => {
            e.target.classList.remove('dragging'); // 원래대로 복구
            draggedItemKey = null;
        });

        // 3. 드래그 중인 물건이 나(다른 폴더) 위로 지나갈 때
        div.addEventListener('dragover', (e) => {
            e.preventDefault(); // 이거 안 하면 drop 이벤트가 발생 안 함 (필수!)
        });

        // 4. 드롭 (내려놨다!) - 순서 변경 실행
        div.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetKey = key; // 내가 놓은 곳(도착지)의 폴더 ID
            if (draggedItemKey !== targetKey) {
                reorderFolders(draggedItemKey, targetKey);
            }
        });

    } else {
        // 일반 모드일 때만 클릭해서 이동
        div.onclick = () => {
            currentFolderFilter = key;
            renderSidebar();
            renderList();
            closeSidebar();
        };
    }
    
    return div;
}

// [v1.24.0] 실제 데이터 순서 바꾸기 로직
function reorderFolders(fromKey, toKey) {
    // 1. 현재 순서대로 배열 만들기
    let sortedList = Object.entries(allFoldersData).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
    
    // 2. 출발지와 도착지의 현재 위치(index) 찾기
    const fromIndex = sortedList.findIndex(item => item[0] === fromKey);
    const toIndex = sortedList.findIndex(item => item[0] === toKey);

    if (fromIndex < 0 || toIndex < 0) return;

    // 3. 배열에서 빼서 새로운 위치에 끼워넣기
    const [movedItem] = sortedList.splice(fromIndex, 1); // 뽑아내기
    sortedList.splice(toIndex, 0, movedItem); // 끼워넣기

    // 4. 모든 폴더에 0, 1, 2... 순서표 다시 붙이기
    const updates = {};
    sortedList.forEach((item, index) => {
        const key = item[0];
        const data = item[1];
        
        data.order = index; // 내 메모리 업데이트
        
        // DB 저장용 데이터 준비
        if (currentUser) {
            updates[`users/${currentUser.uid}/folders/${key}/order`] = index;
        } else {
            allFoldersData[key].order = index;
        }
    });

    // 5. 저장
    if (currentUser) {
        update(ref(db), updates);
    } else {
        localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(allFoldersData));
        renderSidebar(); // 로컬일 땐 수동으로 다시 그려줌
    }
}

function updateFolder(key, oldName) {
    const newName = prompt("폴더 이름을 수정하세요:", oldName);
    if (!newName || newName === oldName) return;

    if (currentUser) {
        update(ref(db, `users/${currentUser.uid}/folders/${key}`), { name: newName });
    } else {
        allFoldersData[key].name = newName;
        localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(allFoldersData));
        renderSidebar();
    }
}

function deleteFolder(key, name) {
    if (!confirm(`'${name}' 폴더를 삭제하시겠습니까?\n(링크는 삭제되지 않고 '미분류'로 이동됩니다)`)) return;

    // 이 폴더에 있던 링크들을 찾아서 '폴더 없음' 상태로 변경
    const linksToUpdate = Object.keys(allLinksData).filter(k => allLinksData[k].folderId === key);

    if (currentUser) {
        remove(ref(db, `users/${currentUser.uid}/folders/${key}`));
        linksToUpdate.forEach(linkKey => update(ref(db, `users/${currentUser.uid}/links/${linkKey}`), { folderId: null }));
    } else {
        delete allFoldersData[key];
        linksToUpdate.forEach(linkKey => allLinksData[linkKey].folderId = null);
        localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(allFoldersData));
        saveToLocal(allLinksData);
        renderSidebar();
        renderList();
    }
}


// ============================================================
// 9. 링크 카드 관련 기능 (Link Actions)
// ============================================================

function toggleSort() {
    isAscending = !isAscending;
    document.getElementById('sortBtn').innerText = isAscending ? "↑ 오래된순" : "↓ 최신순";
    renderList();
}

window.toggleFavorite = function (key) {
    if (isCheckMode) return;
    const currentStatus = allLinksData[key].isFavorite || false;

    // 토글(Toggle): 켜져있으면 끄고, 꺼져있으면 켬
    if (currentUser) {
        update(ref(db, `users/${currentUser.uid}/links/${key}`), { isFavorite: !currentStatus });
    } else {
        allLinksData[key].isFavorite = !currentStatus;
        saveToLocal(allLinksData);
        renderList();
    }
}

// 점 세개(...) 버튼 눌렀을 때 메뉴 열기
window.toggleMoreMenu = function (key) {
    if (isCheckMode) return;
    const menu = document.getElementById(`menu-${key}`);
    const card = document.getElementById(`card-${key}`);

    if (!menu || !card) return;

    const isVisible = menu.classList.contains('show');
    closeAllMenus(); // 다른 메뉴들은 다 닫음

    if (!isVisible) {
        menu.classList.add('show');
        card.classList.add('z-active');
        activeMenuKey = key;
    }
}

function closeAllMenus() {
    document.querySelectorAll('.more-menu-popup').forEach(el => el.classList.remove('show'));
    document.querySelectorAll('.card').forEach(el => el.classList.remove('z-active'));
    activeMenuKey = null;
}

window.copyLink = function (key) {
    closeAllMenus();
    const link = allLinksData[key];
    if (!link) return;
    navigator.clipboard.writeText(link.url).then(() => {
        alert('주소가 복사되었습니다!');
    }).catch(err => {
        alert('복사 실패: ' + err);
    });
}

window.shareLink = function (key) {
    closeAllMenus();
    const link = allLinksData[key];
    if (!link) return;

    // 모바일 기본 공유 기능 사용
    if (navigator.share) {
        navigator.share({
            title: link.title,
            text: link.desc || link.title,
            url: link.url
        }).catch((error) => console.log('공유 취소됨', error));
    } else {
        alert('이 브라우저는 공유 기능을 지원하지 않아 주소를 복사합니다.');
        window.copyLink(key);
    }
}

// 폴더 이동 팝업 열기
window.openFolderModal = function (key) {
    // 체크모드가 아닐 때만 개별 메뉴에서 열림. 
    // 체크모드일 때는 하단 '이동' 버튼(key 없이 호출)으로만 열려야 함.
    if (isCheckMode && key) return;

    editingKey = key || null; // key가 없으면 null (일괄 처리 모드)
    closeAllMenus();

    const list = document.getElementById('folderSelectList');
    list.innerHTML = '';

    // 모달 타이틀 설정
    const title = document.querySelector('#folderModal .modal-title');
    if (editingKey) {
        title.innerText = '폴더로 이동';
    } else {
        title.innerText = `${selectedKeys.size}개 항목 이동`;
    }

    // '미분류' 선택지
    const unclassItem = document.createElement('div');
    unclassItem.className = 'folder-select-item';
    unclassItem.innerText = '미분류 (폴더 없음)';
    unclassItem.onclick = () => moveLinkToFolder(null);
    list.appendChild(unclassItem);

    // 내 폴더 목록 선택지
    Object.entries(allFoldersData).forEach(([fKey, folder]) => {
        const item = document.createElement('div');
        item.className = 'folder-select-item';

        // 싱글 모드일 때만 현재 폴더 표시
        if (editingKey && allLinksData[editingKey].folderId === fKey) {
            item.classList.add('selected');
        }
        item.innerText = folder.name;
        item.onclick = () => moveLinkToFolder(fKey);
        list.appendChild(item);
    });

    document.getElementById('folderModal').classList.add('open');
}

function moveLinkToFolder(folderId) {
    if (editingKey) {
        // [단일 이동]
        if (currentUser) {
            update(ref(db, `users/${currentUser.uid}/links/${editingKey}`), { folderId: folderId });
        } else {
            allLinksData[editingKey].folderId = folderId;
            saveToLocal(allLinksData);
            renderList();
            renderSidebar();
        }
    } else if (selectedKeys.size > 0) {
        // [일괄 이동]
        if (currentUser) {
            const updates = {};
            selectedKeys.forEach(key => {
                updates[`users/${currentUser.uid}/links/${key}/folderId`] = folderId;
            });
            update(ref(db), updates); // 루트(db)에서 경로별 업데이트
        } else {
            selectedKeys.forEach(key => {
                if (allLinksData[key]) allLinksData[key].folderId = folderId;
            });
            saveToLocal(allLinksData);
            renderList();
            renderSidebar();
        }
        exitCheckMode(); // 이동 후 선택 모드 종료
    }

    document.getElementById('folderModal').classList.remove('open');
    editingKey = null;
}

function deleteNonFavorites() {
    if (!confirm('즐겨찾기(★)된 링크를 제외하고 모두 삭제합니다.')) return;

    if (currentUser) {
        Object.keys(allLinksData).forEach(key => {
            if (!allLinksData[key].isFavorite) remove(ref(db, `users/${currentUser.uid}/links/${key}`));
        });
    } else {
        let newLinks = {};
        Object.keys(allLinksData).forEach(key => {
            if (allLinksData[key].isFavorite) newLinks[key] = allLinksData[key];
        });
        allLinksData = newLinks;
        saveToLocal(allLinksData);
        renderList();
        renderSidebar();
    }
}

function resetAll() {
    if (!confirm('모든 링크를 삭제합니다.')) return;
    if (currentUser) {
        remove(dbLinksRef);
    } else {
        allLinksData = {};
        saveToLocal(allLinksData);
        renderList();
        renderSidebar();
    }
}

function deleteSelectedItems() {
    if (selectedKeys.size === 0) return alert('선택된 항목이 없습니다.');
    if (!confirm(`${selectedKeys.size}개의 항목을 삭제하시겠습니까?`)) return;

    if (currentUser) {
        selectedKeys.forEach(key => remove(ref(db, `users/${currentUser.uid}/links/${key}`)));
    } else {
        selectedKeys.forEach(key => delete allLinksData[key]);
        saveToLocal(allLinksData);
    }
    exitCheckMode();
    if (!currentUser) { renderList(); renderSidebar(); }
}

// ============================================================
// 10. 유틸리티 함수 (Utility Functions)
// ============================================================
// 날짜 변환, URL 분석 등 도와주는 작은 함수들입니다.

function formatDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}. ${hh}:${min}`;
}

function getYoutubeId(url) {
    // 유튜브 주소 패턴을 검사해서 영상 ID만 뽑아냄
    const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
    return (match && match[2].length === 11) ? match[2] : null;
}

function detectCategory(url) {
    const lower = url.toLowerCase();

    // 특정 단어가 포함되어 있는지 확인해서 카테고리 결정
    if (lower.includes('music.youtube.com')) return 'music';
    if (getYoutubeId(url)) return 'youtube';

    const newsKeywords = ['news', 'ytn', 'jtbc', 'kbs', 'sbs', 'mbc', 'chosun', 'joongang', 'donga', 'hani', 'khan', 'kmib', 'yonhap', 'maekyung', 'hankyung', 'segye', 'munhwa', 'cnn', 'bbc', 'reuters', 'pressian', 'nocut', 'imnews'];
    if (newsKeywords.some(keyword => lower.includes(keyword))) return 'news';

    if (lower.includes('music') || lower.includes('melon') || lower.includes('spotify')) return 'music';
    if (lower.includes('instagram') || lower.includes('facebook') || lower.includes('twitter') || lower.includes('tiktok') || lower.includes('x.com')) return 'sns';
    if (lower.includes('coupang') || lower.includes('gmarket') || lower.includes('aliexpress') || lower.includes('11st') || lower.includes('auction') || lower.includes('ssg') || lower.includes('smartstore') || lower.includes('kurly') || lower.includes('musinsa')) return 'shopping';
    if (lower.includes('cafe') || lower.includes('dcinside') || lower.includes('fmkorea') || lower.includes('ruliweb') || lower.includes('clien') || lower.includes('damoang') || lower.includes('theqoo') || lower.includes('instiz') || lower.includes('reddit') || lower.includes('ppomppu') || lower.includes('slrclub') || lower.includes('bobaedream') || lower.includes('mlbpark') || lower.includes('todayhumor') || lower.includes('dogdrip') || lower.includes('humoruniv') || lower.includes('etoland') || lower.includes('coolenjoy') || lower.includes('quasarzone') || lower.includes('okky') || lower.includes('inven') || lower.includes('82cook') || lower.includes('gasengi') || lower.includes('meeco') || lower.includes('mule') || lower.includes('coinpan') || lower.includes('nate')) return 'community';

    return 'web'; // 아무것도 해당 안 되면 일반 웹사이트
}

function saveToLocal(data) {
    localStorage.setItem(LOCAL_LINKS_KEY, JSON.stringify(data));
}


// ============================================================
// 11. 핵심 기능: 링크 추가 및 수정 (Core Features)
// ============================================================

async function addLink() {
    const input = document.getElementById('linkInput');
    const btn = document.getElementById('addBtn');
    let url = input.value.trim();

    if (!url) return alert('주소를 입력해주세요!');
    // http가 없으면 붙여주기
    if (!url.startsWith('http')) url = 'https://' + url;

    btn.disabled = true;
    btn.innerText = '가져오는 중...';

    // 카테고리 자동 감지
    let category = detectCategory(url);
    let type = (category === 'youtube') ? 'youtube' : 'web';

    let linkData = {
        url: url,
        category: category,
        type: type,
        timestamp: Date.now(),
        isFavorite: false,
        folderId: null
    };

    // 현재 특정 폴더를 보고 있다면, 그 폴더에 바로 저장
    if (currentFolderFilter !== 'all' && currentFolderFilter !== 'unclassified') {
        linkData.folderId = currentFolderFilter;
    }

    // [중요] 외부 서버에서 제목/이미지 가져오기
    try {
        const ytId = getYoutubeId(url);
        if (ytId) {
            // 유튜브 정보 가져오기
            const response = await fetch(`https://noembed.com/embed?url=${url}`);
            const data = await response.json();
            linkData.videoId = ytId;
            linkData.title = data.title || '유튜브 영상';
            linkData.desc = data.author_name || '설명 없음';
            linkData.publisher = (category === 'music') ? 'Youtube Music' : 'Youtube';
            linkData.type = 'youtube';
        } else {
            // 일반 웹사이트 정보 가져오기 (microlink 사용)
            const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
            const json = await response.json();
            const data = json.data;
            linkData.title = data.title || url;
            linkData.image = data.image?.url || 'https://via.placeholder.com/120?text=No+Image';
            linkData.desc = data.description || '';
            linkData.publisher = data.publisher || new URL(url).hostname;
        }

        // 데이터 저장 (로그인 여부에 따라 분기)
        if (currentUser) {
            push(dbLinksRef, linkData);
        } else {
            const tempKey = 'guest_link_' + Date.now();
            allLinksData[tempKey] = linkData;
            saveToLocal(allLinksData);
            renderList();
            renderSidebar();
        }

        input.value = ''; // 입력창 비우기

    } catch (error) {
        alert('오류: ' + error.message);
    } finally {
        // 성공하든 실패하든 버튼 원상복구
        btn.disabled = false;
        btn.innerText = '저장';
    }
}

window.updateCategory = function (key, newCategory) {
    if (isCheckMode) return;

    if (currentUser) {
        update(ref(db, `users/${currentUser.uid}/links/${key}`), { category: newCategory });
    } else {
        allLinksData[key].category = newCategory;
        saveToLocal(allLinksData);
        renderList();
    }
}

window.openEditModal = function (key) {
    if (isCheckMode) return;
    const link = allLinksData[key];
    if (!link) return;
    editingKey = key;
    closeAllMenus();
    document.getElementById('editTitleInput').value = link.title || '';
    document.getElementById('editDescInput').value = link.desc || '';
    document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('open');
    editingKey = null;
}

function saveEdit() {
    if (!editingKey) return;
    const newTitle = document.getElementById('editTitleInput').value;
    const newDesc = document.getElementById('editDescInput').value;

    if (currentUser) {
        update(ref(db, `users/${currentUser.uid}/links/${editingKey}`), { title: newTitle, desc: newDesc });
    } else {
        allLinksData[editingKey].title = newTitle;
        allLinksData[editingKey].desc = newDesc;
        saveToLocal(allLinksData);
        renderList();
    }
    closeEditModal();
}


// ============================================================
// 12. 화면 필터 및 렌더링 (Filtering & Rendering)
// ============================================================

window.filterList = function (category) {
    currentFilter = category;
    exitCheckMode();

    // 탭 버튼 스타일 변경 (선택된 것만 active)
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.id === `tab-${category}`));

    const addBox = document.getElementById('addBox');
    const searchBox = document.getElementById('searchBox');
    const searchInput = document.getElementById('searchInput');

    // 검색 탭일 때만 검색창 보여주기
    if (category === 'search') {
        addBox.style.display = 'none';
        searchBox.style.display = 'flex';
        searchInput.focus();
    } else {
        addBox.style.display = 'flex';
        searchBox.style.display = 'none';
        searchInput.value = '';
    }
    renderList();
}

function toggleSelectMode() {
    if (isCheckMode) {
        exitCheckMode(); // 이미 켜져있으면 끄기
    } else {
        enterCheckMode(); // 꺼져있으면 켜기
    }
}

function enterCheckMode(firstKey) {
    isCheckMode = true;
    selectedKeys.clear();
    closeAllMenus();
    if (firstKey) selectedKeys.add(firstKey);
    
    // 하단 선택 바 보여주기
    document.getElementById('selectionBar').classList.add('show');

    // 상단 버튼 모양 변경 (선택 -> 취소)
    const selBtn = document.getElementById('selectModeBtn');
    if(selBtn) {
        selBtn.innerText = '취소';
        selBtn.style.background = '#333';
        selBtn.style.color = 'white';
    }

    renderList();
}

function exitCheckMode() {
    isCheckMode = false;
    selectedKeys.clear();
    
    // 하단 선택 바 숨기기
    document.getElementById('selectionBar').classList.remove('show');

    // 상단 버튼 모양 복구 (취소 -> 선택)
    const selBtn = document.getElementById('selectModeBtn');
    if(selBtn) {
        selBtn.innerText = '✓ 선택';
        selBtn.style.background = ''; // 원래 스타일로 복구
        selBtn.style.color = '';
    }

    renderList();
}

// 카드 클릭 이벤트 핸들러
window.handleCardClick = function (e, key, url) {
    // 체크모드일 땐 링크 이동 막고 선택만 토글
    if (isCheckMode) {
        e.preventDefault();
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);
        renderList();
        return;
    }
    // 평소엔 <a> 태그 덕분에 자동으로 새 창이 열림
}

// 꾹 누르기(Long Press) 감지
window.startLongPress = function (key) {
    if (isCheckMode) return;
    // 0.8초 동안 누르고 있으면 체크모드 진입
    pressTimer = setTimeout(() => {
        enterCheckMode(key);
        if (navigator.vibrate) navigator.vibrate(50); // 진동 피드백
    }, 800);
}
window.cancelLongPress = function () {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
}

// [최종 화면 그리기] 데이터 목록을 순회하며 HTML을 만듭니다.
function renderList() {
    const list = document.getElementById('cardList');
    list.innerHTML = '';

    // 1. 데이터를 배열로 바꾸고 정렬
    let links = Object.entries(allLinksData).map(([k, v]) => ({ key: k, ...v }));
    links.sort((a, b) => isAscending ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);

    // 2. 폴더 필터링
    if (currentFolderFilter !== 'all') {
        if (currentFolderFilter === 'unclassified') {
            links = links.filter(l => !l.folderId);
        } else {
            links = links.filter(l => l.folderId === currentFolderFilter);
        }
    }

    // 3. 카테고리/검색 필터링
    if (currentFilter === 'search') {
        const keyword = document.getElementById('searchInput').value.toLowerCase();
        if (keyword) links = links.filter(l => (l.title || '').toLowerCase().includes(keyword) || (l.desc || '').toLowerCase().includes(keyword));
    } else if (currentFilter === 'favorite') {
        links = links.filter(l => l.isFavorite === true);
    } else if (currentFilter !== 'all') {
        links = links.filter(l => l.category === currentFilter);
    }

    // 선택된 개수 표시
    document.getElementById('selCountText').innerText = `${selectedKeys.size}개 선택됨`;

    // 4. 표시할 내용이 없을 때 안내 문구
    if (links.length === 0) {
        let msg = '저장된 링크가 없습니다.';
        if (currentFilter === 'search') msg = '검색 결과가 없습니다.';
        else if (currentFolderFilter !== 'all') msg = '이 폴더는 비어있습니다.';
        list.innerHTML = `<p style="text-align:center; color:#adb5bd; margin-top:50px; font-size:14px;">${msg}</p>`;
        return;
    }

    // 5. 카드 하나씩 만들기 (Loop)
    links.forEach(link => {
        const card = document.createElement('div');
        const isSelected = selectedKeys.has(link.key);
        card.id = `card-${link.key}`;
        card.className = `card ${isCheckMode ? 'checking' : ''} ${isSelected ? 'selected' : ''}`;
        card.onclick = (e) => handleCardClick(e, link.key, link.url);

        // 카테고리 변경 셀렉트 박스
        const selectHtml = `
            <select class="category-select cat-${link.category}" onchange="updateCategory('${link.key}', this.value)" onclick="event.stopPropagation()">
                <option value="youtube" ${link.category === 'youtube' ? 'selected' : ''}>YOUTUBE</option>
                <option value="music" ${link.category === 'music' ? 'selected' : ''}>MUSIC</option>
                <option value="news" ${link.category === 'news' ? 'selected' : ''}>NEWS</option>
                <option value="sns" ${link.category === 'sns' ? 'selected' : ''}>SNS</option>
                <option value="shopping" ${link.category === 'shopping' ? 'selected' : ''}>SHOPPING</option>
                <option value="community" ${link.category === 'community' ? 'selected' : ''}>COMMUNITY</option>
                <option value="web" ${link.category === 'web' ? 'selected' : ''}>WEB</option>
            </select>`;

        // 더보기(...) 메뉴 버튼
        const moreBtn = isCheckMode ? '' : `
            <button class="more-btn" onclick="event.stopPropagation(); toggleMoreMenu('${link.key}')">⋮</button>
            <div id="menu-${link.key}" class="more-menu-popup">
                <button class="menu-item" onclick="event.stopPropagation(); shareLink('${link.key}')">공유</button>
                <button class="menu-item" onclick="event.stopPropagation(); copyLink('${link.key}')">링크 복사</button>
                <div class="menu-separator"></div>
                <button class="menu-item" onclick="event.stopPropagation(); openEditModal('${link.key}')">내용 수정</button>
                <button class="menu-item" onclick="event.stopPropagation(); openFolderModal('${link.key}')">폴더 이동</button>
                <button class="menu-item danger" onclick="event.stopPropagation(); deleteLink('${link.key}')">삭제</button>
            </div>`;

        let hostname = '';
        try { hostname = new URL(link.url).hostname; } catch (e) { }
        const dateStr = formatDate(link.timestamp);

        let imageUrl = link.image;
        let description = link.desc || '설명이 없습니다.';

        if (link.type === 'youtube' || (link.category === 'music' && link.videoId)) {
            imageUrl = `https://img.youtube.com/vi/${link.videoId}/mqdefault.jpg`;
            if (!link.desc || link.desc === '설명 없음') description = '유튜브에서 보기 (클릭)';
        }

        // 폴더 이름 표시
        let folderNameHtml = '';
        if (link.folderId && allFoldersData[link.folderId]) {
            const folderName = allFoldersData[link.folderId].name;
            folderNameHtml = `
                <span class="card-folder-tag">
                    <svg width="18" height="18" viewBox="0 0 24 24" style="margin-right:5px;">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="#FFC107"/>
                    </svg>
                    ${folderName}
                </span>`;
        }

        const checkOverlay = `<div class="check-overlay"><div class="check-circle">✔</div></div>`;
        const linkHref = isCheckMode ? 'javascript:void(0)' : link.url;

        const imgContent = `<div class="img-link" tabindex="-1">
                                <img src="${imageUrl}" class="card-img" onerror="this.src='https://via.placeholder.com/120?text=Link'">
                            </div>`;

        const starClass = link.isFavorite ? 'active' : '';
        const starChar = link.isFavorite ? '★' : '☆';
        const starBtnCircle = `<button class="star-btn-circle ${starClass}" onclick="event.stopPropagation(); toggleFavorite('${link.key}')">${starChar}</button>`;

        // 카드 HTML 조립
        card.innerHTML = `${selectHtml}${folderNameHtml}${moreBtn}${starBtnCircle}
            <div class="card-layout">
                <div class="card-img-area" 
                     onmousedown="startLongPress('${link.key}')" 
                     onmouseup="cancelLongPress()" 
                     onmouseleave="cancelLongPress()"
                     ontouchstart="startLongPress('${link.key}')" 
                     ontouchend="cancelLongPress()"
                     ontouchmove="cancelLongPress()">
                    ${imgContent}
                    ${checkOverlay}
                </div>
                <div class="card-info-area">
                    <div>
                        <a href="${linkHref}" target="_blank" class="card-title">${link.title}</a>
                        <p class="card-desc">${description}</p>
                    </div>
                    <div class="card-footer">
                        <span class="publisher-text">${link.publisher || hostname}</span>
                        <span class="date-text">${dateStr}</span>
                    </div>
                </div>
            </div>`;

        list.appendChild(card);
    });
}

window.deleteLink = function (key) {
    closeAllMenus();
    if (currentUser) {
        remove(ref(db, `users/${currentUser.uid}/links/${key}`));
    } else {
        delete allLinksData[key];
        saveToLocal(allLinksData);
        renderList();
        renderSidebar();
    }
}