import {
    allUsers
} from "./sampleAllUserJson.js"

const displayAllUsersView = function(users) {
    const allUsersMainElement = document.createElement("main");
    allUsersMainElement.classList.add("main-content")
    users.forEach(user => {
    const singleUserTile = document.createElement("div");
    singleUserTile.classList.add("single-user-tile")
    singleUserTile.setAttribute("id" , "mom")
    const singleUserName = document.createElement("h1")
    singleUserName.classList.add("single-user-name")
    singleUserName.innerText = user.name;
    const singleUserIcon = document.createElement("img")
    singleUserIcon.classList.add("user-icon")
    singleUserIcon.setAttribute("src" , "/front-end/images/woman_1f469.png")
    const tasksAssigned = document.createElement("p")
    tasksAssigned.classList.add("tasks-assigned")
    tasksAssigned.innerText = "number of tasks"
        
    });
    const allUsersPageElement
}