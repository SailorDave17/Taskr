import{
    createHeader
} from "./front-end/Js/header.js"

import{
    displaySingleUserView 
} from "./front-end/Js/singleuserview.js"

import{
    createFooter
} from "./front-end/Js/footer.js"

const container = document.queryselector ('container');

container.prepend(createHeader());
const userNamePageElement = document.createElement("h1");
userNamePageElement.classList.add("username");
container.appendChild(userNamePageElement);


fetch("http://localhost:8080/api/users")
.then(response => response.json())
.then(users => displaySingleUserView(users))
.catch(error => console.log (error));

container.appendChild(createFooter())
