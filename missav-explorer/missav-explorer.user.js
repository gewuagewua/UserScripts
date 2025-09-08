// ==UserScript==
// @name         MissAv 收藏批量备份 + WebDAV
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  批量备份 MissAv 收藏视频到 WebDAV，并支持下载、删除、搜索
// @author       You
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      *
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    // =============== 配置 ===============
    let webdavUrl = 'https://your-webdav-server.com';
    let webdavUsername = 'username';
    let webdavPassword = 'password';
    let webdavfold = '/MissAv收藏';

    // ================= 工具函数 =================
    function sanitizeFileName(name){
        return name.replace(/[\/\\:\*\?"<>\|]/g,'_');
    }

    function showModal(msg, timeout=2000){
        const m=document.createElement('div');
        Object.assign(m.style,{position:'fixed',top:'10px',right:'10px',padding:'10px',
                               backgroundColor:'rgba(0,0,0,0.7)',color:'white',zIndex:99999});
        m.textContent=msg; document.body.appendChild(m);
        setTimeout(()=>m.remove(),timeout);
    }

    // ================= WebDAV =================
    const WebDAVManager=(function(){
        let url='',username='',password='';
        function updateConfig(u,user,pass){url=u; username=user; password=pass;}

        async function GM_xhr(opt){
            return new Promise((resolve,reject)=>{
                GM_xmlhttpRequest({
                    method: opt.method, url: url+opt.path,
                    headers:{'Authorization':'Basic '+btoa(username+':'+password), ...(opt.headers||{})},
                    data: opt.data||null,
                    onload:xhr=>{xhr.status>=200&&xhr.status<300?resolve(xhr):reject(xhr)},
                    onerror:xhr=>reject(xhr)
                });
            });
        }

        async function createFolder(folderName){
            try{await GM_xhr({method:'MKCOL',path:folderName.endsWith('/')?folderName:folderName+'/'}); showModal('文件夹创建成功')}
            catch(e){if(e.status!==409) showModal('创建失败:'+e.status)}
        }

        async function uploadFile(folderName,fileName,fileContent){
            try{await GM_xhr({method:'HEAD',path:folderName+'/'+fileName}); console.log(fileName+' 已存在')}
            catch(xhr){if(xhr.status===404){await GM_xhr({method:'PUT',path:folderName+'/'+fileName,data:fileContent}); console.log(fileName+' 上传成功')}}
        }

        async function downloadFile(folderName,fileName,zip=null){
            const xhr=await GM_xhr({method:'GET',path:folderName+'/'+fileName});
            const fileContent=xhr.responseText; const content=fileContent; // 直接下载 JSON 内容
            if(zip){zip.file(sanitizeFileName(fileName),content)}
            else{const blob=new Blob([content],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=sanitizeFileName(fileName); a.click();}
        }

        async function deleteFile(folderName,fileName){await GM_xhr({method:'DELETE',path:folderName+'/'+fileName})}

        return {updateConfig,createFolder,uploadFile,downloadFile,deleteFile};
    })();
    unsafeWindow.WebDAVManager=WebDAVManager;
    WebDAVManager.updateConfig(webdavUrl,webdavUsername,webdavPassword);
    WebDAVManager.createFolder(webdavfold);

    // ================= MissAv 收藏抓取 =================
    async function fetchMissAvFavorites(page=1, limit=20){
        const url=`https://api.missav.com/favorites?page=${page}&limit=${limit}`; // 示例 API
        return new Promise((resolve,reject)=>{
            GM_xmlhttpRequest({
                method:'GET', url:url,
                onload:xhr=>resolve(JSON.parse(xhr.responseText)),
                onerror:xhr=>reject(xhr)
            });
        });
    }

    async function fetchAllFavorites(){
        let page=1, all=[];
        while(true){
            const data=await fetchMissAvFavorites(page);
            if(!data || data.length===0) break;
            all=all.concat(data); page++;
        }
        return all;
    }

    // ================= UI =================
    async function showFavoritesDialog(){
        const favs=await fetchAllFavorites();
        let listHTML='';
        favs.forEach(f=>{
            const fileName=sanitizeFileName(f.title+'.json');
            listHTML+=`<li><input type="checkbox" name="fileCheckbox"><a data-display-name="${fileName}">${f.title}</a></li>`;
        });

        // 创建对话框
        const dialog=document.createElement('div');
        Object.assign(dialog.style,{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
                                   background:'#fff',padding:'20px',borderRadius:'10px',width:'80%',maxHeight:'80%',
                                   overflowY:'auto',zIndex:9999,boxShadow:'0 0 20px rgba(0,0,0,0.2)'});

        const h1=document.createElement('h1'); h1.textContent='MissAv 收藏备份'; dialog.appendChild(h1);

        const ul=document.createElement('ul'); ul.innerHTML=listHTML; dialog.appendChild(ul);

        const btnContainer=document.createElement('div'); dialog.appendChild(btnContainer);

        function getSelected(){return Array.from(ul.querySelectorAll('input[name="fileCheckbox"]:checked'));}
        function toggleSelection(){ul.querySelectorAll('input[name="fileCheckbox"]').forEach(cb=>cb.style.display=cb.style.display==='none'?'inline-block':'none')}
        function toggleSelectAll(){const sel=getSelected(); const allChecked=sel.length===ul.querySelectorAll('input[name="fileCheckbox"]').length; ul.querySelectorAll('input[name="fileCheckbox"]').forEach(cb=>cb.checked=!allChecked);}
        async function downloadSelected(){
            const sel=getSelected(); if(sel.length===0){showModal('没有选中文件'); return;}
            const zip=new JSZip();
            for(const cb of sel){const li=cb.closest('li'); const fn=li.querySelector('a[data-display-name]').dataset.displayName; await WebDAVManager.downloadFile(webdavfold,fn,zip);}
            const blob=await zip.generateAsync({type:'blob'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='selected_files.zip'; a.click(); showModal('下载完成');
        }
        async function deleteSelected(){
            const sel=getSelected(); if(sel.length===0){showModal('没有选中'); return;} if(!confirm('确认删除?')) return;
            for(const cb of sel){const li=cb.closest('li'); const fn=li.querySelector('a[data-display-name]').dataset.displayName; await WebDAVManager.deleteFile(webdavfold,fn); li.style.textDecoration='line-through';}
            showModal('删除完成');
        }

        const buttons=[
            {text:'选择列表',onclick:toggleSelection},{text:'全部选中',onclick:toggleSelectAll},
            {text:'删除选中',onclick:deleteSelected},{text:'下载选中',onclick:downloadSelected},
            {text:'关闭',onclick:()=>dialog.remove()}
        ];
        buttons.forEach(b=>{const btn=document.createElement('button'); btn.textContent=b.text; btn.onclick=b.onclick; btn.style.margin='5px'; btnContainer.appendChild(btn);});

        document.body.appendChild(dialog);
    }

    // ================= 启动 =================
    showFavoritesDialog();

})();
