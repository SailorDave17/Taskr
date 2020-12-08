package com.taskr.core;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.storages.TaskStorage;
import com.taskr.core.storages.TaskTemplateStorage;
import com.taskr.core.storages.UserStorage;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.Set;

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
        Set<User> candidateUsers = new HashSet<>();

        Iterable<User> allUsers = userStorage.findAll();
        System.out.println(allUsers);
        for (User user : allUsers){
            if (!taskTemplate.getUsersWhoCannotDoThisTask().contains(user)){
                candidateUsers.add(user);
            }
        }
        User assignedUser = candidateUsers.iterator().next();
        for(User user : candidateUsers) {
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
        userStorage.updateUser(assignedUser);
        userStorage.save(assignedUser);
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
