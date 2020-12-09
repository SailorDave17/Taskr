import {
    allUsers
} from "./sampleAllUserJson.js"

const displaySingleUserView = function(user) { 
    console.log (user) 
    const mainElement = document.createElement("main");
    mainElement.classList.add("main-content");
    const userPageHeader = document.createElement("div");
    userPageHeader.classList.add("user-page-header");
    console.log(user.userColor)
    user.userColor = "rose"
    userPageHeader.setAttribute('id' , user.userColor)
    // clearChildren(userPageHeader);
    const userNamePageElement = document.createElement("h1");
    userNamePageElement.classList.add("username");
    userNamePageElement.innerText = `${user.name}'s Task List` //whatever day is being accessed by the user. default will be Sunday
    console.log(user.userIcon) 
    user.userIcon = "/front-end/images/Dad.png"
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
    populateTaskList(user.taskList , listOfTasks)
    
    
    //calculating percent of tasks completed for progress bar
    // user.userNumberTasksAssigned = 2
    const percentOfTasksDone = user.numberTasksComplete*100 / user.numberTasksAssigned;
    console.log(percentOfTasksDone);
    // console.log(user.userNumberTasksAssigned);

    // //set up progress bar
    const displayProgressBar = document.createElement("progress");
    displayProgressBar.classList.add("user-progress-bar");
    displayProgressBar.setAttribute("value", percentOfTasksDone);
    //displayProgressBar.setAttribute("value", "70");
    displayProgressBar.setAttribute("max", "100");
    mainElement.appendChild(displayProgressBar);
    

    return mainElement;
}

const clearChildren = function (element) {
    while (element.firstChild) {
        element.removeChild(element.lastChild);
    }
}

export {
    displaySingleUserView
    // clearChildren
}

function populateTaskList(taskList, taskListElement) {
    taskList.forEach(task => {
        const taskStickyNote = document.createElement("div");
        taskStickyNote.classList.add("chores-list");
        const checkBox = document.createElement("input");
        checkBox.setAttribute("type", "checkbox");
        checkBox.classList.add("chore-done");
        if (task.done) {
            checkBox.checked = true;
        }
        // checkBox.setAttribute("id", task.title)
        checkBox.addEventListener('click', (checkboxEvent) => {
            checkboxEvent.preventDefault();
            checkboxEvent.stopPropagation();
            clearChildren(taskListElement);
            task.done = true;
            fetch("http://localhost:8080/api/task/" + task.id + "/update", {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(task)
            })
                .then(response => response.json())
                // .then(response => console.log(response))
                .then(userTasks => populateTaskList(userTasks , taskListElement))
                .catch(error => console.error(error.stack));
        });



        const choreName = document.createElement("label");
        choreName.classList.add("chore-name");
        choreName.innerText = task.title;
        //choreName.innerText = "Vacuum Family Room";
        checkBox.setAttribute("id", "check-chore");
        choreName.setAttribute("for", "check-chore");
        const taskInfoList = document.createElement("ul");
        const taskDueDate = document.createElement("li");
        taskDueDate.classList.add("task-due-date");
        taskDueDate.innerText = task.dueBy;
        //taskDueDate.innerText = "Sunday";
        const taskDuration = document.createElement("li");
        taskDuration.classList.add("task-duration");
        taskDuration.innerText = task.minutesExpectedToComplete + " minutes";
        //taskDuration.innerText = "30 minutes";
        taskListElement.appendChild(taskStickyNote);
        taskStickyNote.appendChild(checkBox);
        taskStickyNote.appendChild(choreName);
        taskStickyNote.appendChild(taskInfoList);
        taskStickyNote.appendChild(taskDueDate);
        taskStickyNote.appendChild(taskDuration);
    });
}
