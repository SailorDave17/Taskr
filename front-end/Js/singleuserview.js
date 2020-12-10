import { createFooter } from "./footer.js";
import { displayHeader } from "./header.js";

const progressBar = document.createElement("progress");


const displaySingleUserView = function(user) {
    console.log(user)
    const mainElement = document.querySelector(".main-content")
        // const mainElement = document.createElement("main");
        // mainElement.classList.add("main-content");
    const userPageHeader = document.createElement("div");
    userPageHeader.classList.add("user-page-header");
    console.log(user.userColor);
    user.userColor = user.userColor;
    userPageHeader.setAttribute('id', user.userColor)
        // clearChildren(userPageHeader);
    const userNamePageElement = document.createElement("h1");
    userNamePageElement.classList.add("username");
    userNamePageElement.innerText = `${user.name}'s Task List` //whatever day is being accessed by the user. default will be Sunday
    console.log(user.userIcon)
        // user.userIcon = "/front-end/images/" + user.userIcon;
    const userIcon = document.createElement("img");
    userIcon.classList.add("user-page-icon");
    userIcon.setAttribute("src", user.userIcon);
    mainElement.appendChild(userPageHeader);
    userPageHeader.appendChild(userNamePageElement);
    userPageHeader.appendChild(userIcon);
    //set up sticky notes of tasks
    const listOfTasks = document.createElement("div");
    listOfTasks.classList.add("user-task-list");
    mainElement.appendChild(listOfTasks);
    populateTaskList(user.taskList, listOfTasks)
        //finish creating and update progress bar
    progressBar.classList.add("user-progress-bar");
    progressBar.setAttribute("max", "100");
    updateProgressBar(progressBar, user.taskList);
    mainElement.appendChild(progressBar);
    // const footer = document.createElement("footer");
    // footer.classList.add("footer")
    // footer.innerHTML = '&copy 2020 - Team Taskr - We Can {Code} IT'
    mainElement.append(createFooter());


    return mainElement;
}

const updateProgressBar = function(progressBar, tasks) {
    let taskCount = tasks.length;
    let completedTasks = 0;
    tasks.forEach(task => {
            if (task.done) {
                completedTasks++;
            }
        })
        //Setting user bar progress with setAttribute
    if (taskCount > 0) {
        progressBar.setAttribute("value", (completedTasks / taskCount) * 100);
    }

}



const clearChildren = function(element) {
    while (element.firstChild) {
        element.removeChild(element.lastChild);
    }
}

export {
    displaySingleUserView
}

function populateTaskList(taskList, taskListElement) {
    taskList.forEach(task => {
        const taskStickyNote = document.createElement("div");
        taskStickyNote.classList.add("chores-list");
        taskStickyNote.id = `${task.id}`;
        const checkBox = document.createElement("input");
        checkBox.setAttribute("type", "checkbox");
        checkBox.classList.add("chore-done");
        if (task.done) {
            checkBox.checked = true;
        }
        checkBox.setAttribute("id", task.title)
        checkBox.addEventListener('click', (checkboxEvent) => {
            checkboxEvent.preventDefault();
            checkboxEvent.stopPropagation();
            clearChildren(taskListElement);
            task.done = checkBox.checked;
            let numTasksComplete;
            fetch("http://localhost:8080/api/task/" + task.id + "/update", {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(task)
                })
                .then(response => response.json())
                // .then(response => console.log(response))
                .then(userTasks => {
                    populateTaskList(userTasks, taskListElement)
                    updateProgressBar(progressBar, userTasks)

                })
                .catch(error => console.error(error.stack));
        });



        const choreName = document.createElement("label");
        choreName.classList.add("chore-name");
        choreName.innerText = task.title;
        checkBox.setAttribute("id", "check-chore");
        choreName.setAttribute("for", "check-chore");
        const taskInfoList = document.createElement("ul");
        const taskDueDate = document.createElement("li");
        taskDueDate.classList.add("task-due-date");
        taskDueDate.innerText = task.dueBy;
        const taskDuration = document.createElement("li");
        taskDuration.classList.add("task-duration");
        taskDuration.innerText = task.minutesExpectedToComplete + " minutes";
        taskListElement.appendChild(taskStickyNote);
        taskStickyNote.appendChild(checkBox);
        taskStickyNote.appendChild(choreName);
        taskStickyNote.appendChild(taskInfoList);
        taskStickyNote.appendChild(taskDueDate);
        taskStickyNote.appendChild(taskDuration);
    });
}