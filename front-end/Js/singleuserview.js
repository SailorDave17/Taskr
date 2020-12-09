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
    const userIcon = document.createElement("img");
    userIcon.classList.add("user-page-icon");
    userIcon.setAttribute("src", "/front-end/images/woman_1f469.png")
    mainElement.appendChild(userPageHeader);
    userPageHeader.appendChild(userNamePageElement);
    userPageHeader.appendChild(userIcon);

    //set up sticky notes of tasks
    const listOfTasks = document.createElement("div");
    listOfTasks.classList.add("user-task-list");
    mainElement.appendChild(listOfTasks);
    let numberOfTasksDone = 0;
    user.taskList.forEach(task => {
        const taskStickyNote = document.createElement("div")
        taskStickyNote.classList.add("chores-list");

        const checkBox = document.createElement("input");
        checkBox.setAttribute("type", "checkbox");
        checkBox.classList.add("chore-done");
        // checkBox.setAttribute("id", task.title)
        checkBox.addEventListener('click', (checkboxEvent) => {
            checkboxEvent.preventDefault();
            clearChildren(mainElement);
            // const taskStatusJson = {
            //     "id": task.id,
            //     "title": task.title,
            //     "minutesExpectedToComplete": task.minutesExpectedToComplete,
            //     "dueBy": task.dueBy,
            //     "done": true,
            //     "actualWorkTime": task.actualWorkTime,
            //     "description": task.description,
            //     "templateId": task.templateId  
            // }
            task.done=true 
            console.log(task.done)
            console.log(task)
            fetch("http://localhost:8080/api/task/" + task.id +"/update" ,{
                method: 'PATCH', 
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(task)
            })
            .then(response => response.json())
            // .then(response => console.log(response))
            .then(user => displaySingleUserView(user))
            .then(singleUserElement => mainElement.appendChild(singleUserElement))
            .catch(error => console.error(error.stack));
        });
        if (task.done === true) {
            // checkBox.check();
            numberOfTasksDone = numberOfTasksDone++;
        }
        const choreName = document.createElement("label");
        choreName.classList.add("chore-name")
        choreName.innerText = task.title;
        //choreName.innerText = "Vacuum Family Room";
        checkBox.setAttribute("id", "check-chore");
        choreName.setAttribute("for", "check-chore");
        const taskInfoList = document.createElement("ul")
        const taskDueDate = document.createElement("li");
        taskDueDate.classList.add("task-due-date");
        taskDueDate.innerText = task.dueBy;
        //taskDueDate.innerText = "Sunday";
        const taskDuration = document.createElement("li");
        taskDuration.classList.add("task-duration");
        taskDuration.innerText = task.minutesExpectedToComplete + " minutes";
        //taskDuration.innerText = "30 minutes";
        listOfTasks.appendChild(taskStickyNote);
        taskStickyNote.appendChild(checkBox);
        taskStickyNote.appendChild(choreName);
        taskStickyNote.appendChild(taskInfoList);
        taskStickyNote.appendChild(taskDueDate);
        taskStickyNote.appendChild(taskDuration); //not sure if appending them all to the same thing is the right choice//
    });
    
    //calculating percent of tasks completed for progress bar
    // user.userNumberTasksAssigned = 2
    const percentOfTasksDone = numberOfTasksDone*100 / user.userNumberTasksAssigned;
    console.log(percentOfTasksDone);
    console.log(user.userNumberTasksAssigned);

    //set up progress bar
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