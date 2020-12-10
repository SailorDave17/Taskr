import {
    displayHeader
} from "./js/header.js"

import {
    displaySingleUserView
} from "./js/singleuserview.js"

import {
    createFooter
} from "./js/footer.js"

import {
    displayAllUsersView
} from "./js/allusersview.js"

const container = document.querySelector('.container');

container.prepend(displayHeader());
// This is the path to the single user view.
const mainElement = document.createElement("main");
mainElement.classList.add("main-content");
container.appendChild(mainElement);

//This is the path to the all user view.
// const allUsersMainElement = document.createElement("main");
// allUsersMainElement.classList.add("all-users-main");
// container.appendChild(allUsersMainElement);

const userNamePageElement = document.createElement("h1");
userNamePageElement.classList.add("username");
container.appendChild(userNamePageElement);


fetch("http://localhost:8080/api/user/2")
    .then(response => response.json())
    //.then(json => console.log(json))
    .then(user => displaySingleUserView(user))
    .then(singleUserElement => mainElement.appendChild(singleUserElement))
    .catch(error => console.log(error));


// fetch("http://localhost:8080/api/user/2")
//     .then(response => response.json())
//     //.then(json => console.log(json))
//     .then(users => displayAllUsersView(users))
//     .then(allUsersView => allUsersMainElement.appendChild(allUsersView))
//     .catch(error => console.log(error));


container.appendChild(createFooter())