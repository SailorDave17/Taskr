import {
    allUsers
} from "./sampleAllUserJson.js"

const displayAllUsersView = function (users) {
    const allUsersMainElement = document.createElement("main");
    allUsersMainElement.classList.add("main-content")
    users.forEach(user => {
        const singleUserTile = document.createElement("div");
        singleUserTile.classList.add("single-user-tile")
        user.userColor = "rose"
        singleUserTile.setAttribute("id", user.userColor)
        const singleUserName = document.createElement("h1")
        singleUserName.classList.add("single-user-name")
        singleUserName.innerText = user.name;
        const singleUserIcon = document.createElement("img")
        singleUserIcon.classList.add("user-icon")
        singleUserIcon.setAttribute("src", user.userIcon)
        const tasksAssigned = document.createElement("p")
        tasksAssigned.classList.add("tasks-assigned")
        tasksAssigned.innerText = "number of tasks"
        const progressBarElement = document.createElement("progress")
        progressBarElement.classList.add("progress-bar")
        const numberOfTaskDone = 2
        const userPercentTaskDone = numberOfTaskDone / tasksAssigned
        progressBarElement.setAttribute("value", userPercentTaskDone)
        progressBarElement.setAttribute("max", "100")

        



    });

    const pieChartElement = document.createElement("div")
    pieChartElement.classList.add("piechart")

    return {
        allUsersMainElement
    }

}

export {
    displayAllUsersView
}