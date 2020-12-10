import {
    displayAllUsersView
} from "./allusersview.js"

import {
    allUsersMainElement
} from "../app.js"

const displayHeader = function() {

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
    goToAllUsersDisplay.addEventListener('click', (clickEvent) => {
        clickEvent.preventDefault();
        const mainContent = document.querySelector(".main-content"); //.remove();
        fetch("http://localhost:8080/api/users")
            .then(response => response.json())
            .then(users => displayAllUsersView(users))
            .then(allUsersView => mainContent.replaceWith(allUsersView))
            // .then(allUsersView => document.querySelector(".container").append(allUsersView))
            .catch(error => console.log(error));

    });
    header.appendChild(goToAllUsersDisplay);

    header.innerText = "Taskr user view "

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