import{
    displayAllUsersView
}from "./allusersview.js"
const displayHeader = function () {
    
    const header = document.createElement("header");
    header.classList.add("title");
    const dropDown = document.createElement("div");
    dropDown.classList.add("dropdown");
    const dropbtnElement = document.createElement("button");
    dropbtnElement.classList.add("dropbtn");
    const hamburgerMenuElement = document.createElement("img");
    hamburgerMenuElement.classList.add("hamburger");
    hamburgerMenuElement.setAttribute("src", "/front-end/images/menu.png");
    hamburgerMenuElement.setAttribute("width", "100px");
    const myDropdownbtn = document.createElement("div");
    myDropdownbtn.setAttribute("id", "myDropdown");
    myDropdownbtn.classList.add("dropdown-content");
    const goToAllUsersDisplay = document.createElement("a");
    goToAllUsersDisplay.classList.add("menu-item");
    goToAllUsersDisplay.innerText = "All Users";
    goToAllUsersDisplay.addEventListener('click', () => {
        fetch("http://localhost:8080/api/users")
        .then(response => response.json())
        //.then(json => console.log(json))
        .then(users => displayAllUsersView(users))
        .then(allUsersView => allUsersMainElement.appendChild(allUsersView))
        .catch(error => console.log(error));
        
    });


    header.innerText = "Taskr user view "


    // header.innerHTML = `<div class="dropdown"> <button class="dropbtn">
    // <img class = "hamburger" src = "/front-end/images/menu.png" width = 100px>
    // </button><div id="myDropdown" class="dropdown-content">
    //         <a href="../front-end/Js/allusersview.js" class="menu-item">All Users</a>
    //         <a href="front-end\Js\alltasksview.js" class="menu-item">My Tasks</a>
    //     </div>
    // </div>
    // Taskr User View`


    header.prepend(dropDown);
    dropDown.appendChild(dropbtnElement);
    dropbtnElement.append(hamburgerMenuElement);
    dropDown.appendChild(myDropdownbtn);
    myDropdownbtn.appendChild(goToAllUsersDisplay);
    return header;

}

export {
    displayHeader
}


