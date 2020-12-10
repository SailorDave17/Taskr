package com.taskr.core;

import com.taskr.core.model.Task;
import com.taskr.core.model.TaskTemplate;
import com.taskr.core.model.User;
import com.taskr.core.storage.TaskStorage;
import com.taskr.core.storage.TaskTemplateStorage;
import com.taskr.core.storage.UserStorage;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class ResourceManager {

    UserStorage userStorage;
    TaskStorage taskStorage;
    TaskTemplateStorage taskTemplateStorage;

    public ResourceManager(UserStorage userStorage, TaskStorage taskStorage, TaskTemplateStorage taskTemplateStorage) {
        this.userStorage = userStorage;
        this.taskStorage = taskStorage;
        this.taskTemplateStorage = taskTemplateStorage;
    }

    public void updateAllTasksBasedOnTemplate(Long taskTemplateId) {
        TaskTemplate taskTemplate = taskTemplateStorage.findById(taskTemplateId);
        for (Task task : taskStorage.findByTemplateId(taskTemplateId)) {
            task.setDescription(taskTemplate.getDescription());
            task.setMinutesExpectedToComplete(taskTemplate.getMinutesExpectedToComplete());
            task.setTitle(taskTemplate.getName());
            taskStorage.save(task);
        }
    }

    public void allocateSingleTask(TaskTemplate taskTemplate){
        List<User> candidateUsers = new ArrayList<>();
        Iterable<User> allUsers = userStorage.findAll();
        for (User user : allUsers){
            if (!taskTemplate.getUsersWhoCannotDoThisTask().contains(user)){
                candidateUsers.add(userStorage.findById(user.getId()));
            }
        }
        Collections.shuffle(candidateUsers);
        User assignedUser = candidateUsers.get(0);
        for(User user : candidateUsers) {
            userStorage.updateUser(user);
            userStorage.updateUser(assignedUser);
            if(user.getRemainingAvailableTime()>assignedUser.getRemainingAvailableTime()){
                assignedUser = user;
            }else if (user.getRemainingAvailableTime() == assignedUser.getRemainingAvailableTime()){
                if (Math.random()*2>=1){
                    assignedUser = user;
                }

            }
        }
        Task newTask = new Task(assignedUser, taskTemplate);
        taskStorage.save(newTask);
        User userInDb = userStorage.findById(assignedUser.getId());
        userInDb.setTaskList(assignedUser.getTaskList());
        userStorage.updateUser(userInDb);
        userStorage.save(userInDb);
    }

    public void allocateAllTasks(){
        for (TaskTemplate taskTemplate : taskTemplateStorage.findAll()){
            allocateSingleTask(taskTemplate);
        }
    }

    public void allocateTasks(Set<TaskTemplate> taskTemplateList) {
        for (TaskTemplate taskTemplate : taskTemplateList){
            allocateSingleTask(taskTemplate);
        }
    }
}
