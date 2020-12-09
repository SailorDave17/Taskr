package com.taskr.core.model;

import com.fasterxml.jackson.annotation.JsonManagedReference;
import org.springframework.transaction.annotation.Transactional;

import javax.persistence.*;
import java.util.*;

@Entity
public class TaskTemplate {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    private Integer minutesExpectedToComplete;
    private String description;
    private Integer actualWorkTime;
    private String dueDate;
//    @Fetch(value = FetchMode.SELECT)
    @JsonManagedReference
    @ManyToMany(fetch = FetchType.EAGER)//, mappedBy = "tasksUserCannotDo", cascade = CascadeType.ALL)
    private Collection<User> usersWhoCannotDoThisTask;

    public TaskTemplate(String name, String description, Integer actualWorkTime, Integer minutesExpectedToComplete, String dueDate, User ... usersWhoCannotDoThisTask) {
        this.name = name;
        this.description = description;
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = minutesExpectedToComplete;
        this.dueDate = dueDate;
        this.usersWhoCannotDoThisTask = new HashSet<>(Arrays.asList(usersWhoCannotDoThisTask));
    }

    public TaskTemplate(String name, String description, Integer actualWorkTime, String dueDate, User ... usersWhoCannotDoThisTask) {
        this.name = name;
        this.description = description;
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = actualWorkTime;
        this.dueDate = dueDate;
        this.usersWhoCannotDoThisTask = new HashSet<>(Arrays.asList(usersWhoCannotDoThisTask));
    }

    public TaskTemplate(String name, int minutesExpectedToComplete, int actualWorkTime) {
        this.name = name;
        this.description = "";
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = minutesExpectedToComplete;
        this.usersWhoCannotDoThisTask = new HashSet<>();
    }

    public TaskTemplate() {

    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public long getId() {
        return id;
    }

    public Integer getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(Integer minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
    }

    public void setActualWorkTime(Integer actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }

    public Integer getActualWorkTime() {
        return actualWorkTime;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Collection<User> getUsersWhoCannotDoThisTask() {
        return usersWhoCannotDoThisTask;
    }

    public void addUserWhoCannotDoThisTask(User user) {
        if(usersWhoCannotDoThisTask == null){
            usersWhoCannotDoThisTask = new HashSet<>();
        }
        this.usersWhoCannotDoThisTask.add(user);
        user.addTaskUserCannotDo(this);
    }

    public void removeUserWhoCannotDoThisTask(User user){
        this.usersWhoCannotDoThisTask.remove(user);
        user.removeTaskUserCannotDo(this);
    }

    public void setUsersWhoCannotDoThisTask(Iterable<User> usersWhoCannotDoThisTask) {
        usersWhoCannotDoThisTask = new HashSet<>();
        for (User user : usersWhoCannotDoThisTask) {
            this.usersWhoCannotDoThisTask.add(user);
            user.addTaskUserCannotDo(this);
        }
    }

    @Override
    public String toString() {
        return "TaskTemplate{" +
                "id=" + id +
                ", name='" + name + '\'' +
                ", minutesExpectedToComplete=" + minutesExpectedToComplete +
                ", description='" + description + '\'' +
                ", actualWorkTime=" + actualWorkTime +
                '}';
    }

    public String getDueDate() {
        return this.dueDate;

    }

    public void setDueDate(String dueDate) {
        this.dueDate = dueDate;
    }
}
