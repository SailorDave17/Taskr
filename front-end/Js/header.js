const displayHeader = function () {
    
    const header = document.createElement("header");
    header.classList.add("title");
    header.innerHTML = `
    <div class="dropdown">
        <button class="dropbtn"><img class = "hamburger" src = "/front-end/images/menu.png" width = 100px></button>
        <div id="myDropdown" class="dropdown-content">
            <a href="/front-end/household-userview.html" class="menu-item">All Users</a>
            <a href="/front-end/household-taskview.html" class="menu-item">All Tasks</a>
            <a href="/front-end/user-view.html" class="menu-item">My Tasks</a>
            <a href="/front-end/customization-page.html" class="menu-item">Customize</a>
        </div>
    </div>
    Taskr User View`



    return header;

}



export {
    displayHeader
}

