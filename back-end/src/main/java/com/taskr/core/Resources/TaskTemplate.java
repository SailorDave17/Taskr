package com.taskr.core.Resources;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import javax.persistence.OneToMany;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;

@Entity
public class TaskTemplate {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    private Long minutesExpectedToComplete = 0L;
    private String description;
    private Long actualWorkTime = 0L;
    @OneToMany
    private Set<User> usersWhoCanDoThisTask;

    public TaskTemplate(String name) {
        this.name = name;
    }

    public TaskTemplate() {

    }

    public String getName() {
        return  name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public long getId() {
        return id;
    }

    public Long getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(Long minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
    }

    public void setActualWorkTime(Long actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }

    public Long getActualWorkTime() {
        return actualWorkTime;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
    public Set<User> getUsersWhoCanDoThisTask(){
        return usersWhoCanDoThisTask;
    }

    public void setUsersWhoCanDoThisTask(Set<User> usersWhoCanDoThisTask) {
        this.usersWhoCanDoThisTask = usersWhoCanDoThisTask;
    }
}
